import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { workerDatabaseConfig } from '../core/database';
import { NoticeSender } from './notice-sender';

export class JobWorker {
  readonly pool = new Pool(workerDatabaseConfig());
  async transaction<T>(work:(client:PoolClient)=>Promise<T>) {
    const client=await this.pool.connect();
    try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async claim(schoolId:string) {
    return this.transaction(async client=>{
      await client.query("SELECT set_config('app.school_id',$1,true)",[schoolId]);
      await client.query("UPDATE outbox_jobs SET state='failed',last_error='Lease expired after maximum attempts',lease_token=NULL,lease_until=NULL WHERE school_id=$1 AND state='processing' AND lease_until<=now() AND attempts=3",[schoolId]);
      const candidate=await client.query("SELECT id FROM outbox_jobs WHERE school_id=$1 AND attempts<3 AND ((state='queued' AND available_at<=now()) OR (state='processing' AND lease_until<=now())) ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",[schoolId]);
      if(!candidate.rowCount)return null;
      return (await client.query("UPDATE outbox_jobs SET state='processing',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '30 seconds' WHERE id=$1 RETURNING *",[candidate.rows[0].id,randomUUID()])).rows[0];
    });
  }
  async execute(job:any) {
    try {
      return await this.transaction(async client=>{
        await client.query("SELECT set_config('app.school_id',$1,true),set_config('app.user_id',$2,true)",[job.school_id,job.actor_user_id]);
        const current=await client.query("SELECT * FROM outbox_jobs WHERE id=$1 AND lease_token=$2 AND state='processing' AND lease_until>now() FOR UPDATE",[job.id,job.lease_token]);
        if(!current.rowCount)return false;
        const member=await client.query('SELECT * FROM active_membership($1)',[job.school_id]);
        if(!member.rowCount||member.rows[0].id!==job.actor_membership_id||member.rows[0].role!=='headteacher') {
          await client.query("UPDATE outbox_jobs SET state='cancelled',last_error='Authorization no longer permits this export',lease_until=NULL,lease_token=NULL WHERE id=$1",[job.id]);return false;
        }
        if(job.kind!=='audit.export')throw new Error('Unsupported job kind');
        const rows=(await client.query('SELECT id,action,target_id,created_at,metadata FROM audit_events WHERE school_id=$1 ORDER BY created_at DESC,id LIMIT 501',[job.school_id])).rows;
        const result={schoolId:job.school_id,generatedAt:new Date().toISOString(),limit:500,truncated:rows.length>500,rows:rows.slice(0,500)};
        await client.query("UPDATE outbox_jobs SET state='done',result=$2,completed_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL WHERE id=$1",[job.id,JSON.stringify(result)]);return true;
      });
    } catch(error) {
      await this.transaction(async client=>{
        await client.query("SELECT set_config('app.school_id',$1,true)",[job.school_id]);
        await client.query("UPDATE outbox_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,available_at=now()+interval '5 seconds'*attempts,lease_until=NULL,lease_token=NULL,last_error=$3 WHERE id=$1 AND lease_token=$2 AND state='processing'",[job.id,job.lease_token,error instanceof Error&&error.message==='Unsupported job kind'?'Unsupported job kind':'Job failed; review required']);
      });return false;
    }
  }
  async runOnce() {
    const schools=(await this.pool.query('SELECT school_id FROM pending_job_schools()')).rows;
    for(const school of schools){const job=await this.claim(school.school_id);if(job)await this.execute(job);}
  }
  async close(){await this.pool.end();}
}
if(require.main===module) {
  const worker=new JobWorker(),notices=new NoticeSender();let stopping=false;
  const stop=()=>{stopping=true;};process.on('SIGTERM',stop);process.on('SIGINT',stop);
  (async()=>{while(!stopping){try{await worker.runOnce();await notices.runOnce();}catch{console.error('Worker cycle failed');}await new Promise(resolve=>setTimeout(resolve,1000));}await worker.close();await notices.close();})().catch(()=>{process.exitCode=1;});
}
