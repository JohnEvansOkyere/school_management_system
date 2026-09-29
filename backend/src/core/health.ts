import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

export const bundledMigrations = path.resolve(__dirname, '../../migrations');

export async function readiness(pool: Pick<Pool, 'query'>, migrationsDir = bundledMigrations) {
  const checks = { database: 'ok', migrations: 'ok' };
  try { await pool.query('SELECT 1'); } catch { return { ready: false, checks: { database: 'failed', migrations: 'unknown' } }; }
  try {
    const recorded = new Set((await pool.query('SELECT migration_ledger_names() AS name')).rows.map(row => row.name));
    const bundled = readdirSync(migrationsDir).filter(name => name.endsWith('.sql'));
    if (bundled.some(name => !recorded.has(name))) checks.migrations = 'behind';
  } catch { checks.migrations = 'unknown'; }
  return { ready: checks.migrations === 'ok', checks };
}

export async function assertMigrated(pool: Pick<Pool, 'query'>, migrationsDir = bundledMigrations) {
  const result = await readiness(pool,migrationsDir);
  if (result.checks.database !== 'ok') throw new Error('Database is not reachable; refusing to start');
  if (result.checks.migrations !== 'ok') throw new Error(`Database migrations are ${result.checks.migrations}; apply the reviewed migrations before starting this version`);
}
