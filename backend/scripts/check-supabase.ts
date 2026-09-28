import { Pool } from 'pg';
import type { TLSSocket } from 'node:tls';
import { supabaseConfig } from '../src/core/database';

async function main() {
  if (process.env.DATABASE_TARGET !== 'supabase') throw new Error('Set DATABASE_TARGET=supabase in the root .env file first');
  const pool = new Pool(supabaseConfig());
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT current_database() AS database, current_user AS role,
        roles.rolsuper AS superuser, roles.rolbypassrls AS bypassrls
      FROM pg_roles AS roles
      WHERE roles.rolname = current_user
    `);
    const row = result.rows[0];
    if (!row) throw new Error('Could not verify the connected database role');
    if (row.role !== 'school_app') throw new Error('Connection did not resolve to the restricted school_app role');
    if (row.superuser || row.bypassrls) throw new Error('Connected role is privileged; use the restricted school_app role');
    if (!(client.connection.stream as TLSSocket).encrypted) throw new Error('Database connection did not negotiate TLS');
    console.log(`Connected to PostgreSQL database ${row.database} as restricted role ${row.role}; TLS verified. No credentials displayed.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Supabase connection check failed');
  process.exitCode = 1;
});
