import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');const {JobWorker}=require('../dist/jobs/worker');
const schoolA='10000000-0000-4000-8000-000000000001',schoolB='10000000-0000-4000-8000-000000000002';
const user='20000000-0000-4000-8000-000000000001',member='30000000-0000-4000-8000-000000000001';
const owner=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
let app:any,base:string,worker:any,cookie:string,csrf:string;
async function call(url:string,method='GET',body?:unknown){return fetch(`${base}${url}`,{method,headers:{cookie,'content-type':'application/json','x-csrf-token':csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function queue(){const id=randomUUID();assert.equal((await call(`/schools/${schoolA}/audit-exports`,'POST',{operationId:id})).status,201);return id;}
async function status(id:string){return (await call(`/schools/${schoolA}/audit-exports/${id}`)).json();}
before(async()=>{process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;worker=new JobWorker();const response=await call('/auth/login','POST',{email:'head@example.test',password:'Synthetic-only-2026!'});cookie=response.headers.get('set-cookie')!.split(';')[0];csrf=(await response.json()).csrfToken;});
after(async()=>{await app?.close();await worker?.close();await owner.end();});
test('queue deduplicates retries and worker uses a restricted role',async()=>{
  const id=await queue();assert.equal((await call(`/schools/${schoolA}/audit-exports`,'POST',{operationId:id})).status,201);
  assert.equal((await owner.query('SELECT count(*) FROM outbox_jobs WHERE id=$1',[id])).rows[0].count,'1');
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='audit.export.requested'",[id])).rows[0].count,'1');
  const role=(await worker.pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];assert.deepEqual(role,{rolsuper:false,rolbypassrls:false});
  await assert.rejects(worker.pool.query("UPDATE outbox_jobs SET payload='{}'"),/permission denied/);
  await worker.runOnce();assert.equal((await status(id)).state,'done');
});
test('export contains school A records only and cross-school download denies',async()=>{
  const aId=randomUUID(),bId=randomUUID();
  await owner.query("INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id) VALUES($1,$2,$3,'school.a.fixture',$2),($4,$5,$6,'school.b.fixture',$5)",[aId,schoolA,member,bId,schoolB,'30000000-0000-4000-8000-000000000002']);
  const id=await queue();await worker.runOnce();const job=await status(id);assert.equal(job.state,'done');assert.equal(job.result.schoolId,schoolA);
  assert.equal(job.result.rows.some((row:any)=>row.id===aId),true);assert.equal(job.result.rows.some((row:any)=>row.id===bId),false);
  const sourceIds=new Set((await owner.query('SELECT id FROM audit_events WHERE school_id=$1',[schoolA])).rows.map(row=>row.id));
  assert.equal(job.result.rows.every((row:any)=>sourceIds.has(row.id)),true);
  assert.equal((await call(`/schools/${schoolB}/audit-exports/${id}`)).status,404);
});
test('completed export becomes unavailable after role change or revocation',async()=>{
  const id=await queue();await worker.runOnce();assert.equal((await status(id)).state,'done');
  await owner.query("UPDATE memberships SET role='teacher' WHERE id=$1",[member]);
  try{assert.equal((await call(`/schools/${schoolA}/audit-exports/${id}`)).status,403);}
  finally{await owner.query("UPDATE memberships SET role='headteacher' WHERE id=$1",[member]);}
  await owner.query('UPDATE memberships SET revoked_at=now() WHERE id=$1',[member]);
  try{assert.equal((await call(`/schools/${schoolA}/audit-exports/${id}`)).status,404);}
  finally{await owner.query('UPDATE memberships SET revoked_at=NULL WHERE id=$1',[member]);}
});
test('revoked membership cancels already queued export and denies download',async()=>{
  const id=await queue();await owner.query('UPDATE memberships SET revoked_at=now() WHERE id=$1',[member]);
  try{await worker.runOnce();assert.equal((await owner.query('SELECT state,result FROM outbox_jobs WHERE id=$1',[id])).rows[0].state,'cancelled');assert.equal((await call(`/schools/${schoolA}/audit-exports/${id}`)).status,404);}
  finally{await owner.query('UPDATE memberships SET revoked_at=NULL WHERE id=$1',[member]);}
});
test('expired lease is reclaimed once and stale worker cannot complete it',async()=>{
  const id=await queue();const stale=await worker.claim(schoolA);assert.equal(stale.id,id);
  await owner.query("UPDATE outbox_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[id]);
  const fresh=await worker.claim(schoolA);assert.equal(fresh.id,id);assert.notEqual(fresh.lease_token,stale.lease_token);
  assert.equal(await worker.execute(stale),false);assert.equal(await worker.execute(fresh),true);assert.equal((await status(id)).attempts,2);
});
test('unsupported jobs retry with backoff then fail for review',async()=>{
  const id=randomUUID();await owner.query("INSERT INTO outbox_jobs(id,school_id,actor_membership_id,actor_user_id,kind) VALUES($1,$2,$3,$4,'unsupported.test')",[id,schoolA,member,user]);
  for(let attempt=1;attempt<=3;attempt++) {
    await owner.query('UPDATE outbox_jobs SET available_at=now() WHERE id=$1',[id]);const claimed=await worker.claim(schoolA);assert.equal(claimed.id,id);assert.equal(await worker.execute(claimed),false);
    const current=(await owner.query('SELECT state,attempts,last_error FROM outbox_jobs WHERE id=$1',[id])).rows[0];assert.equal(current.attempts,attempt);assert.equal(current.state,attempt===3?'failed':'queued');
  }
});
test('parallel workers cannot claim the same queued job',async()=>{
  const id=await queue();const [a,b]=await Promise.all([worker.claim(schoolA),worker.claim(schoolA)]);assert.equal([a,b].filter(Boolean).length,1);const claimed=a??b;assert.equal(claimed.id,id);await worker.execute(claimed);
});
test('final crashed lease becomes failed instead of retrying forever',async()=>{
  const id=await queue();await owner.query("UPDATE outbox_jobs SET state='processing',attempts=3,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1",[id,randomUUID()]);
  await worker.runOnce();const job=await status(id);assert.equal(job.state,'failed');assert.equal(job.attempts,3);assert.equal(job.result,null);
});
test('discovery prioritizes older eligible work across schools',async()=>{
  const a=await queue(),b=randomUUID();await owner.query("INSERT INTO outbox_jobs(id,school_id,actor_membership_id,actor_user_id,kind,available_at) VALUES($1,$2,$3,$4,'audit.export',now()-interval '1 hour')",[b,schoolB,'30000000-0000-4000-8000-000000000002',user]);
  const schools=(await worker.pool.query('SELECT school_id FROM pending_job_schools()')).rows.map((row:any)=>row.school_id);
  assert.ok(schools.indexOf(schoolB)<schools.indexOf(schoolA));await worker.runOnce();assert.equal((await status(a)).state,'done');
});
