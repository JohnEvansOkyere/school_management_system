import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import type { TLSSocket } from 'node:tls';
import path from 'node:path';
import { Pool } from 'pg';

const LOCK_ID = '738451920641';

function migrationConfig() {
  if (process.env.DATABASE_TARGET !== 'supabase') throw new Error('Set DATABASE_TARGET=supabase in the root .env file first');
  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString) throw new Error('DATABASE_MIGRATION_URL is required for hosted migrations; keep it separate from the runtime DATABASE_URL');
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error('DATABASE_MIGRATION_URL must be a valid PostgreSQL URL'); }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('DATABASE_MIGRATION_URL must use the PostgreSQL protocol');
  if (!/^postgres(?:\.[a-z0-9]+)?$/i.test(decodeURIComponent(url.username))) throw new Error('Hosted migrations must use the Supabase postgres administrator role');
  if (url.searchParams.get('sslmode') !== 'verify-full' || !url.searchParams.get('sslrootcert')) throw new Error('DATABASE_MIGRATION_URL must use sslmode=verify-full and provide sslrootcert');
  return { connectionString, max: 1, application_name: 'school-management-migrations' };
}

function migrationFiles() {
  const dir = path.resolve(__dirname, '../migrations');
  return readdirSync(dir).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => {
    const sql = readFileSync(path.join(dir, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply')) throw new Error('Usage: npm run db:migrate:supabase [-- --apply]');
  const apply = args.includes('--apply');
  const pool = new Pool(migrationConfig());
  const client = await pool.connect();
  let locked = false;
  try {
    const identity = await client.query(`
      SELECT current_database() AS database, current_user AS role,
        roles.rolsuper AS superuser, roles.rolcreaterole AS createrole
      FROM pg_roles AS roles WHERE roles.rolname=current_user
    `);
    const row = identity.rows[0];
    if (!row || row.role !== 'postgres' || !row.createrole) throw new Error('Migration connection must resolve to the Supabase postgres administrator role');
    if (!(client.connection.stream as TLSSocket).encrypted) throw new Error('Migration connection did not negotiate TLS');

    if (apply) {
      await client.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_ID]);
      locked = true;
    }

    const ledgerExists = await client.query("SELECT to_regclass('public.school_schema_migrations') IS NOT NULL AS exists");
    const existingSchema = await client.query("SELECT to_regclass('public.schools') IS NOT NULL OR to_regclass('public.users') IS NOT NULL AS exists");
    if (!ledgerExists.rows[0].exists && existingSchema.rows[0].exists) throw new Error('Application tables already exist without this migration ledger; stopping for manual review');

    const applied = ledgerExists.rows[0].exists
      ? await client.query('SELECT name,checksum FROM public.school_schema_migrations ORDER BY name')
      : { rows: [] as Array<{ name: string; checksum: string }> };
    const files = migrationFiles();
    const known = new Map(files.map(file => [file.name, file]));
    for (const prior of applied.rows) {
      const file = known.get(prior.name);
      if (!file) throw new Error(`Migration ledger contains unknown migration ${prior.name}`);
      if (file.checksum !== prior.checksum) throw new Error(`Applied migration changed: ${prior.name}`);
    }
    const appliedNames = new Set(applied.rows.map(migration => migration.name));
    const pending = files.filter(file => !appliedNames.has(file.name));
    console.log(`Supabase database ${row.database}; administrator role verified; TLS verified.`);
    if (!pending.length) console.log('All migrations are already applied.');
    else console.log(`${apply ? 'Applying' : 'Dry run; pending'} ${pending.length} migration(s): ${pending.map(file => file.name).join(', ')}`);
    if (!apply || !pending.length) return;

    await client.query('BEGIN');
    try {
      await client.query('CREATE TABLE IF NOT EXISTS public.school_schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
      await client.query('REVOKE ALL ON TABLE public.school_schema_migrations FROM PUBLIC, anon, authenticated, service_role, school_app');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    for (const file of pending) {
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO public.school_schema_migrations(name,checksum) VALUES ($1,$2)', [file.name, file.checksum]);
        await client.query('COMMIT');
        console.log(`Applied ${file.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_ID]);
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Supabase migration failed');
  process.exitCode = 1;
});
