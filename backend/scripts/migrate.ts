import { Pool } from 'pg';
import { localConfig } from '../src/core/database';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

async function main() {
  const marker = readFileSync(path.resolve(__dirname, '../../.local/postgres/disposable-marker'), 'utf8').trim();
  if (marker !== 'school-saas-disposable') throw new Error('Dedicated disposable cluster required');
  const pool = new Pool(localConfig(true));
  const client = await pool.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of readdirSync(path.resolve(__dirname, '../migrations')).filter(n => n.endsWith('.sql')).sort()) {
      const sql = readFileSync(path.resolve(__dirname, '../migrations', name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (prior.rowCount) { if (prior.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`); continue; }
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)', [name,checksum]); await client.query('COMMIT'); console.log(`Applied ${name}`); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
