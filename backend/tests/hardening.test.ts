import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');const {JobWorker}=require('../dist/jobs/worker');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const s1=randomUUID(),s2=randomUUID(),headM=randomUUID(),soloU=randomUUID(),sharedU=randomUUID(),soloM=randomUUID(),sharedM1=randomUUID(),sharedM2=randomUUID();
let app:any,base:string,head:any,worker:any;
const post=(url:string,body:unknown,headers:Record<string,string>={})=>fetch(`${base}${url}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
async function login(email:string,password='Synthetic-only-2026!'){return post('/auth/login',{email,password});}
async function call(route:string,method='GET',body?:unknown){const r=await fetch(`${base}/schools/${s1}${route}`,{method,headers:{cookie:head.cookie,'content-type':'application/json','x-csrf-token':head.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;worker=new JobWorker();
  const r=await login('head@example.test');head={cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Hardening school one'),($2,'Hardening school two')",[s1,s2]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,'20000000-0000-4000-8000-000000000001','headteacher')",[headM,s1]);
  for(const [id,name] of [[soloU,'Solo Teacher'],[sharedU,'Shared Teacher']])await owner.query("INSERT INTO users(id,display_name,synthetic_login,password_hash) VALUES($1,$2,$3,'x')",[id,name,`${name.split(' ')[0].toLowerCase()}-${id}@example.test`]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'teacher'),($4,$2,$5,'teacher'),($6,$7,$5,'teacher')",[soloM,s1,soloU,sharedM1,sharedU,sharedM2,s2]);
});
after(async()=>{await app?.close();await worker?.close();await owner.end();});

test('sign-in ignores letter case; a wrong password is still refused',async()=>{
  assert.equal((await login('Head@Example.TEST')).status,201);
  assert.equal((await login('head@example.test','not the password')).status,401);
});

test('ten failed sign-ins lock that account for a while, without affecting others',async()=>{
  for(let i=0;i<10;i++)assert.equal((await login('frontdesk@example.test','wrong password '+i)).status,401);
  const locked=await login('frontdesk@example.test');assert.equal(locked.status,429,'even the correct password waits');assert.match((await locked.json()).message,/Too many failed sign-ins/);
  assert.equal((await login('FrontDesk@example.test')).status,429,'case does not sidestep the lock');
  assert.equal((await login('teacher@example.test')).status,201,'other accounts are unaffected');
  for(let i=0;i<10;i++)await login('nobody-here@example.test','x');assert.equal((await login('nobody-here@example.test','x')).status,429,'unknown emails are throttled the same way');
});

test('a headteacher cannot reset the password or phone of an account that also belongs to another school',async()=>{
  assert.equal((await call(`/accounts/${sharedU}/reset-password`,'POST',{})).status,404);
  assert.equal((await call(`/accounts/${sharedU}/phone`,'POST',{phone:'0241234567'})).status,404);
  assert.equal((await owner.query('SELECT phone FROM users WHERE id=$1',[sharedU])).rows[0].phone,null);
  assert.equal((await owner.query("SELECT password_hash FROM users WHERE id=$1",[sharedU])).rows[0].password_hash,'x','password untouched');
  assert.equal((await call(`/accounts/${soloU}/reset-password`,'POST',{})).status,201,'a single-school account can be reset');
  assert.equal((await call(`/accounts/${soloU}/phone`,'POST',{phone:'0241234567'})).status,201);
});

test('housekeeping removes old sessions and receipts but not recent ones or audit history',async()=>{
  const old=randomUUID(),fresh=randomUUID(),oldReceipt=randomUUID(),freshReceipt=randomUUID(),audit=randomUUID();
  await owner.query("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$3,'c',now()-interval '40 days'),($2,$3,'c',now()+interval '1 hour')",[old,fresh,soloU]);
  await owner.query("INSERT INTO command_receipts(school_id,id,actor_membership_id,action,payload_digest,response,created_at) VALUES($1,$2,$4,'x','d','{}',now()-interval '40 days'),($1,$3,$4,'x','d','{}',now())",[s1,oldReceipt,freshReceipt,headM]);
  await owner.query("INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id,created_at) VALUES($1,$2,$3,'old.fixture',$2,now()-interval '400 days')",[audit,s1,headM]);
  const purged=await worker.purgeIfDue();assert.ok(purged.sessions_deleted>=1&&purged.receipts_deleted>=1);
  assert.equal(await worker.purgeIfDue(),null,'runs at most hourly');
  const count=async(sql:string,id:string)=>Number((await owner.query(sql,[id])).rows[0].count);
  assert.equal(await count("SELECT count(*) FROM sessions WHERE token_hash=$1",old),0);assert.equal(await count("SELECT count(*) FROM sessions WHERE token_hash=$1",fresh),1);
  assert.equal(await count("SELECT count(*) FROM command_receipts WHERE id=$1",oldReceipt),0);assert.equal(await count("SELECT count(*) FROM command_receipts WHERE id=$1",freshReceipt),1);
  assert.equal(await count("SELECT count(*) FROM audit_events WHERE id=$1",audit),1,'audit history is kept');
  await assert.rejects(worker.pool.query("DELETE FROM sessions"),/permission denied/);
});

test('every foreign key has a supporting index',async()=>{
  const rows=(await owner.query(`SELECT c.conname FROM pg_constraint c WHERE c.contype='f' AND c.connamespace='public'::regnamespace AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND (SELECT array_agg(t.x ORDER BY t.o) FROM unnest(i.indkey::int2[]) WITH ORDINALITY t(x,o) WHERE t.o<=array_length(c.conkey,1))=c.conkey)`)).rows;
  assert.deepEqual(rows,[]);
});
