import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import path from 'node:path';

export function localConfig(owner = false) {
  return { host: path.resolve(__dirname, '../../../.local/postgres/socket'), port: 55438, database: 'school_saas_local', user: owner ? process.env.USER : 'school_app', max: 5 };
}

export function supabaseConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required when DATABASE_TARGET=supabase');
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL'); }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('DATABASE_URL must use the PostgreSQL protocol');
  const role = decodeURIComponent(url.username);
  if (!/^school_app(?:\.[a-z0-9]+)?$/i.test(role)) throw new Error('Supabase runtime connections must use the restricted school_app database role');
  if (url.searchParams.get('sslmode') !== 'verify-full' || !url.searchParams.get('sslrootcert')) {
    throw new Error('Supabase DATABASE_URL must use sslmode=verify-full and provide sslrootcert');
  }
  return { connectionString, max: 5, application_name: 'school-management-api' };
}

export function appDatabaseConfig() {
  const target = process.env.DATABASE_TARGET ?? (process.env.NODE_ENV === 'production' ? 'supabase' : 'local');
  if (target === 'supabase') return supabaseConfig();
  if (target !== 'local') throw new Error('DATABASE_TARGET must be local or supabase');
  if (process.env.NODE_ENV === 'production') throw new Error('Production requires DATABASE_TARGET=supabase');
  return localConfig();
}

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool(appDatabaseConfig());
  async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async onModuleDestroy() { await this.pool.end(); }
}
