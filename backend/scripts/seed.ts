import { Pool } from 'pg';
import { localConfig } from '../src/core/database';
import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
export const schoolA = '10000000-0000-4000-8000-000000000001';
export const schoolB = '10000000-0000-4000-8000-000000000002';
export const userIds = ['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
async function main() {
  if (readFileSync(path.resolve(__dirname, '../../.local/postgres/disposable-marker'),'utf8').trim() !== 'school-saas-disposable') throw new Error('Disposable cluster required');
  const pool = new Pool(localConfig(true));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [index,login,name] of [[0,'head@example.test','Ama Sample'],[1,'teacher@example.test','Kofi Sample'],[2,'guardian@example.test','Abena Sample']] as const) {
      const salt = randomBytes(16).toString('hex');
      const hash = `${salt}:${scryptSync('Synthetic-only-2026!',salt,64).toString('hex')}`;
      await client.query('INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[userIds[index],name,login,hash]);
    }
    await client.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4) ON CONFLICT(id) DO NOTHING',[schoolA,'Adinkra Synthetic School',schoolB,'Baobab Synthetic School']);
    for (const [index,user,school,role] of [[1,0,schoolA,'headteacher'],[2,0,schoolB,'headteacher'],[3,1,schoolA,'teacher'],[4,2,schoolA,'guardian']] as const) {
      await client.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[`30000000-0000-4000-8000-${String(index).padStart(12,'0')}`,school,userIds[user],role]);
    }
    await client.query('COMMIT'); console.log('Synthetic two-school fixtures ready');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
