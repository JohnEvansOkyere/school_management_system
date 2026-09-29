import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp} = require('../dist/main');
const schoolA='10000000-0000-4000-8000-000000000001';
const schoolB='10000000-0000-4000-8000-000000000002';
const head='20000000-0000-4000-8000-000000000001';
const memberA='30000000-0000-4000-8000-000000000001';
const memberB='30000000-0000-4000-8000-000000000002';
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const runtime=new Pool({...config,user:'school_app',max:1});
let app:any,base:string;
type Login={cookie:string;csrf:string};
async function login(email='head@example.test'):Promise<Login> {
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});
  assert.equal(response.status,201);
  return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};
}
async function call(url:string,account?:Login,method='GET',body?:unknown,csrf=true) {
  return fetch(`${base}${url}`,{method,headers:{'content-type':'application/json',...(account?{cookie:account.cookie,...(csrf?{'x-csrf-token':account.csrf}:{})}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
before(async()=>{process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;});
after(async()=>{await app?.close();await runtime.end();await owner.end();});
test('runtime is non-owner, not privileged, and RLS is forced',async()=>{
  const role=(await runtime.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false});
  const tables=(await runtime.query("SELECT relname,relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relname IN ('users','sessions','schools','memberships','audit_events','outbox_jobs')")).rows;
  assert.equal(tables.length,6);for(const table of tables){assert.equal(table.relrowsecurity,true);assert.equal(table.relforcerowsecurity,true);assert.notEqual(table.owner,'school_app');}
  const policies=(await runtime.query("SELECT tablename,cmd,roles::text[] AS roles FROM pg_policies WHERE schemaname='public' AND tablename IN ('users','sessions') ORDER BY tablename,cmd")).rows;
  assert.deepEqual(policies.map((row:any)=>[row.tablename,row.cmd,row.roles]),[
    ['sessions','INSERT',['school_app']],['sessions','SELECT',['school_app']],['sessions','UPDATE',['school_app']],['users','SELECT',['school_app']],
  ]);
});
test('missing context fails closed; pooled transaction context resets after commit and rollback',async()=>{
  assert.equal((await runtime.query('SELECT * FROM schools')).rowCount,0);
  await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.school_id',$1,true)",[schoolA]);
  assert.equal((await runtime.query('SELECT id FROM schools')).rows[0].id,schoolA);await runtime.query('COMMIT');
  assert.equal((await runtime.query('SELECT * FROM schools')).rowCount,0);
  await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.school_id',$1,true)",[schoolB]);await runtime.query('ROLLBACK');
  assert.equal((await runtime.query('SELECT * FROM schools')).rowCount,0);
});
test('school A context cannot read or change B and tenant changes fail',async()=>{
  await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.school_id',$1,true)",[schoolA]);
  assert.equal((await runtime.query('UPDATE schools SET name=name WHERE id=$1',[schoolB])).rowCount,0);
  await assert.rejects(runtime.query('UPDATE schools SET id=$1 WHERE id=$2',[randomUUID(),schoolA]),/row-level security/);await runtime.query('ROLLBACK');
});
test('audit reference cannot point to membership in another school',async()=>{
  await runtime.query('BEGIN');await runtime.query("SELECT set_config('app.school_id',$1,true)",[schoolA]);
  await assert.rejects(runtime.query('INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id) VALUES($1,$2,$3,$4,$2)',[randomUUID(),schoolA,memberB,'test']),/foreign key/);await runtime.query('ROLLBACK');
});
test('runtime cannot mutate audit history or memberships',async()=>{
  await assert.rejects(runtime.query('DELETE FROM audit_events'),/permission denied/);
  await assert.rejects(runtime.query('UPDATE memberships SET role=role'),/permission denied/);
});
test('missing, invalid, expired and revoked sessions deny',async()=>{
  assert.equal((await call('/auth/session')).status,401);
  assert.equal((await call('/auth/session',{cookie:`school_session=${'a'.repeat(64)}`,csrf:''})).status,401);
  const account=await login();await owner.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[head]);
  assert.equal((await call('/auth/session',account)).status,401);
  const revoked=await login();await owner.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[head]);
  assert.equal((await call('/auth/session',revoked)).status,401);
});
test('teacher cannot select unauthorized school, update settings or inspect audit',async()=>{
  const account=await login('teacher@example.test');
  assert.equal((await call(`/schools/${schoolB}`,account)).status,404);
  assert.equal((await call(`/schools/${schoolA}`,account,'PATCH',{name:'Forbidden',version:1})).status,403);
  assert.equal((await call(`/schools/${schoolA}/audit`,account)).status,403);
});
test('membership revocation affects active session while second school remains accessible',async()=>{
  const account=await login();await owner.query('UPDATE memberships SET revoked_at=now() WHERE id=$1',[memberA]);
  try {assert.equal((await call(`/schools/${schoolA}`,account)).status,404);assert.equal((await call(`/schools/${schoolB}`,account)).status,200);}
  finally{await owner.query('UPDATE memberships SET revoked_at=NULL WHERE id=$1',[memberA]);}
});
test('role changes take effect on an existing session',async()=>{
  const account=await login();await owner.query("UPDATE memberships SET role='teacher' WHERE id=$1",[memberA]);
  try{assert.equal((await call(`/schools/${schoolA}/audit`,account)).status,403);}
  finally{await owner.query("UPDATE memberships SET role='headteacher' WHERE id=$1",[memberA]);}
});
test('CSRF, unknown fields, invalid versions and empty names deny',async()=>{
  const account=await login();
  assert.equal((await call(`/schools/${schoolA}`,account,'PATCH',{name:'New school',version:1},false)).status,403);
  for(const body of [{name:'New school',version:1,role:'headteacher'},{name:'New school',version:0},{name:'   ',version:1}])assert.equal((await call(`/schools/${schoolA}`,account,'PATCH',body)).status,400);
});
test('settings save persists, audit is atomic, stale writes conflict without extra audit',async()=>{
  const account=await login();const prior=await (await call(`/schools/${schoolA}`,account)).json();
  const before=Number((await owner.query('SELECT count(*) FROM audit_events WHERE school_id=$1',[schoolA])).rows[0].count);
  const save=await call(`/schools/${schoolA}`,account,'PATCH',{name:'Adinkra Synthetic School',version:prior.version});assert.equal(save.status,200);
  const saved=await save.json();assert.equal(saved.version,prior.version+1);
  const reload=await (await call(`/schools/${schoolA}`,account)).json();assert.equal(reload.version,saved.version);
  assert.equal((await call(`/schools/${schoolA}`,account,'PATCH',{name:'Stale name',version:prior.version})).status,409);
  assert.equal(Number((await owner.query('SELECT count(*) FROM audit_events WHERE school_id=$1',[schoolA])).rows[0].count),before+1);
});
test('synthetic login is disabled unless explicitly enabled',async()=>{
  delete process.env.DEV_AUTH;
  try{assert.equal((await call('/auth/login',undefined,'POST',{email:'head@example.test',password:'Synthetic-only-2026!'})).status,403);}
  finally{process.env.DEV_AUTH='synthetic-local';}
});
test('foreign website cannot initiate sign-in',async()=>{
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:'https://foreign.example'},body:JSON.stringify({email:'head@example.test',password:'Synthetic-only-2026!'})});
  assert.equal(response.status,403);
});
test('audit failure after settings update rolls back settings and version',async()=>{
  const account=await login();const prior=await (await call(`/schools/${schoolA}`,account)).json();
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_test_audit_failure CHECK(action <> 'school.details.updated') NOT VALID");
  try {
    assert.equal((await call(`/schools/${schoolA}`,account,'PATCH',{name:'Must roll back',version:prior.version})).status,500);
    const after=await (await call(`/schools/${schoolA}`,account)).json();assert.equal(after.name,prior.name);assert.equal(after.version,prior.version);
  } finally {await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_test_audit_failure');}
});
