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
