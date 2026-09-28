import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import path from 'node:path';

export function localConfig(owner = false) {
  if (process.env.NODE_ENV === 'production') throw new Error('Production database configuration is not yet approved');
  return { host: path.resolve(__dirname, '../../../.local/postgres/socket'), port: 55438, database: 'school_saas_local', user: owner ? process.env.USER : 'school_app', max: 5 };
}
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool(localConfig());
  async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
