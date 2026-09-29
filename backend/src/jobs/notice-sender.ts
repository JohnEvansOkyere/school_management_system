import { Pool, PoolClient } from 'pg';
import { workerDatabaseConfig } from '../core/database';
import { SmsProvider, configuredSms } from '../modules/notices/sms.provider';

// Sends queued notice deliveries. A delivery is claimed ('sending') before the provider is called, so a crash can lose a
// message but can never send it twice; stale 'sending' rows are marked failed for a person to decide on.
export class NoticeSender {
  readonly pool = new Pool(workerDatabaseConfig());
  constructor(private readonly sms: SmsProvider | null = configuredSms(), private readonly batch = 10) {}
  private async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async runOnce() {
    const schools = (await this.pool.query('SELECT school_id FROM pending_delivery_schools()')).rows;
    for (const school of schools) await this.serve(school.school_id);
  }
  private async serve(schoolId: string) {
    const claimed = await this.transaction(async client => {
      await client.query("SELECT set_config('app.school_id',$1,true)",[schoolId]);
      await client.query("UPDATE notice_deliveries SET state='failed',last_error='Interrupted while sending; check with the provider before resending',updated_at=now() WHERE school_id=$1 AND state='sending' AND updated_at<now()-interval '5 minutes'",[schoolId]);
      const rows = (await client.query("SELECT d.id,d.to_phone,n.body FROM notice_deliveries d JOIN notices n ON n.school_id=d.school_id AND n.id=d.notice_id WHERE d.school_id=$1 AND d.state='queued' AND n.status='approved' ORDER BY d.id LIMIT $2 FOR UPDATE OF d SKIP LOCKED",[schoolId,this.batch])).rows;
      if (!this.sms) { for (const row of rows) await client.query("UPDATE notice_deliveries SET state='suppressed',last_error='SMS sending is switched off',updated_at=now() WHERE id=$1",[row.id]); return []; }
      for (const row of rows) await client.query("UPDATE notice_deliveries SET state='sending',attempts=attempts+1,updated_at=now() WHERE id=$1",[row.id]);
      return rows as { id: string; to_phone: string; body: string }[];
    });
    for (const row of claimed) {
      let result: { state: string; provider: string | null; id: string | null; error: string | null };
      try { const sent = await this.sms!.send(row.to_phone,row.body,row.id); result = {state:'sent',provider:sent.provider,id:sent.providerMessageId,error:null}; }
      catch (error) { result = {state:'failed',provider:null,id:null,error:(error as Error).message.slice(0,300)}; }
      await this.transaction(async client => {
        await client.query("SELECT set_config('app.school_id',$1,true)",[schoolId]);
        await client.query('UPDATE notice_deliveries SET state=$2,provider=$3,provider_message_id=$4,last_error=$5,updated_at=now() WHERE id=$1',[row.id,result.state,result.provider,result.id,result.error]);
      });
    }
  }
  async close() { await this.pool.end(); }
}
