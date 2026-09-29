import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { localConfig } from '../src/core/database';
import { hashPassword } from '../src/modules/identity/identity.controller';

// Usage: npm run platform-admin -w backend -- "Full Name" email@example.com
// Local: uses the disposable cluster owner. Hosted: DATABASE_TARGET=supabase and DATABASE_MIGRATION_URL (administrator, TLS verify-full).
async function main() {
  const [name, email] = process.argv.slice(2);
  if (!name || !email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Usage: create-platform-admin "Full Name" email@example.com');
  const hosted = process.env.DATABASE_TARGET === 'supabase';
  if (hosted && !process.env.DATABASE_MIGRATION_URL) throw new Error('DATABASE_MIGRATION_URL is required for the hosted database');
  const pool = new Pool(hosted ? { connectionString: process.env.DATABASE_MIGRATION_URL, max: 1 } : localConfig(true));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const password = Array.from(randomBytes(20), byte => alphabet[byte % alphabet.length]).join('');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = randomUUID();
    await client.query('INSERT INTO users(id,display_name,synthetic_login,password_hash,must_change_password) VALUES($1,$2,$3,$4,true)', [id, name, email.toLowerCase(), await hashPassword(password)]);
    await client.query('INSERT INTO platform_admins(user_id) VALUES($1)', [id]);
    await client.query('COMMIT');
    console.log(`Platform administrator created: ${email.toLowerCase()}\nTemporary password (shown once, change it at first sign-in): ${password}`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
