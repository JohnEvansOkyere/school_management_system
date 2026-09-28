import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import path from 'node:path';

export function localConfig(owner = false) {
  return { host: path.resolve(__dirname, '../../../.local/postgres/socket'), port: 55438, database: 'school_saas_local', user: owner ? process.env.USER : 'school_app', max: 5 };
}

export function supabaseConfig() {
  const connectionString = process.env.DATABASE_URL;
  return supabaseRoleConfig(connectionString,'DATABASE_URL','school_app','school-management-api');
}

export function workerDatabaseConfig() {
  const target = process.env.DATABASE_TARGET ?? (process.env.NODE_ENV === 'production' ? 'supabase' : 'local');
  if (target === 'local') {
    if (process.env.NODE_ENV === 'production') throw new Error('Production requires DATABASE_TARGET=supabase');
    return {...localConfig(),user:'school_worker',application_name:'school-management-worker'};
  }
  if (target !== 'supabase') throw new Error('DATABASE_TARGET must be local or supabase');
  return supabaseRoleConfig(process.env.WORKER_DATABASE_URL,'WORKER_DATABASE_URL','school_worker','school-management-worker');
}

function supabaseRoleConfig(connectionString:string|undefined,variable:string,expectedRole:string,applicationName:string) {
  if (!connectionString) throw new Error(`${variable} is required when DATABASE_TARGET=supabase`);
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error(`${variable} must be a valid PostgreSQL connection URL`); }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error(`${variable} must use the PostgreSQL protocol`);
  const role = decodeURIComponent(url.username);
  if (!new RegExp(`^${expectedRole}(?:\\.[a-z0-9]+)?$`,'i').test(role)) throw new Error(`Supabase connections in ${variable} must use the restricted ${expectedRole} database role`);
  if (url.searchParams.get('sslmode') !== 'verify-full' || !url.searchParams.get('sslrootcert')) {
    throw new Error(`Supabase ${variable} must use sslmode=verify-full and provide sslrootcert`);
  }
  return { connectionString, max: 5, application_name: applicationName };
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
