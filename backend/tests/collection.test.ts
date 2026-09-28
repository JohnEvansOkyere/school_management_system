import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const connection={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:'school_saas_local'};
const owner=new Pool({...connection,user:process.env.USER}),runtime=new Pool({...connection,user:'school_app'});
const school=randomUUID(),other=randomUUID(),members=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
let app:any,base:string,head:any,desk:any,year:any,section:any,date:string;
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head,schoolId=school){return fetch(`${base}/schools/${schoolId}${route}`,{method,headers:{cookie:actor.cookie,'x-csrf-token':actor.csrf,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function post(route:string,body:Record<string,unknown>,status=201,actor=head){const r=await call(route,'POST',{operationId:randomUUID(),...body},actor),value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
async function learner(){let a=await post('/admissions',{fullName:'Synthetic collection child',admissionNumber:`COL-${randomUUID().slice(0,8)}`,classId:section.id,startDate:new Date(Date.parse(date)-86400000).toISOString().slice(0,10)});for(const action of ['review','offer','accept','enrol'])a=await post(`/admissions/${a.id}/transition`,{version:a.version,action});return a.learner_id as string;}
async function link(id:string,pickup=true,verify=true){const a=await post('/guardian-links',{learnerId:id,guardianMembershipId:members[2],academic:false,billing:!pickup,pickup,contact:false});return verify?post(`/guardian-links/${a.id}/verify`,{version:1,reason:'Reviewed synthetic guardian rights'}):a;}
const releaseBody=(authority:any)=>({learnerVersion:1,guardianLinkId:authority.id,guardianLinkVersion:authority.version,verificationReason:'Collector verified in person against reviewed school record'});
async function exception(id:string){const detail=await post(`/collection/learners/${id}/cases`,{learnerVersion:1,collectorName:'Synthetic unexpected collector',reason:'Collector has no verified pickup link'},201,desk);return detail.cases[0];}
async function approve(record:any){const detail=await post(`/collection/cases/${record.id}/review`,{version:record.version,action:'approve',reason:'Head reviewed one-time collection authority',verificationReason:'Head verified collector through school identity procedure'});return detail.cases.find((c:any)=>c.id===record.id);}
const exceptionalBody=(record:any)=>({learnerVersion:1,exceptionId:record.id,exceptionVersion:record.version,verificationReason:'Releasing staff verified the approved collector in person'});
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;head=await login('head@example.test');desk=await login('frontdesk@example.test');date=(await owner.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS date")).rows[0].date;
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Synthetic collection school',other,'Other collection school']);
  const users=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
  for(let i=0;i<4;i++)await owner.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',[members[i],school,users[i],['headteacher','teacher','guardian','frontdesk'][i]]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[randomUUID(),other,users[0]]);
  year=await post('/academic-years',{name:'Collection year',startDate:'2026-01-01',endDate:'2028-01-01'});section=await post('/classes',{name:'Collection KG',level:'KG',capacity:100,academicYearId:year.id});
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});
test('collection RLS and narrow pickup function fail closed for wrong schools and roles',async()=>{
  const id=await learner();await link(id);
  for(const table of ['collection_events','collection_cases']){assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount,0);assert.equal((await owner.query('SELECT relforcerowsecurity FROM pg_class WHERE relname=$1',[table])).rows[0].relforcerowsecurity,true);}
  for(const email of ['teacher@example.test','guardian@example.test']){const actor=await login(email);assert.equal((await call('/collection/learners','GET',undefined,actor)).status,403);assert.equal((await call(`/collection/learners/${id}`,'GET',undefined,actor)).status,403);}
  assert.equal((await call(`/collection/learners/${id}`,'GET',undefined,head,other)).status,404);
  assert.equal((await runtime.query('SELECT * FROM collection_pickup_authority($1,$2)',[school,id])).rowCount,0);
  const detail=await (await call(`/collection/learners/${id}`,'GET',undefined,desk)).json();assert.equal(detail.date,date);assert.equal(detail.collectors.length,1);assert.deepEqual(Object.keys(detail.collectors[0]).sort(),['collector_name','id','version']);assert.ok(!('date_of_birth' in detail.learner));assert.ok(!('billing' in detail.collectors[0]));
});
test('billing-only, pending, revoked and inactive guardian authorities cannot release',async()=>{
  for(const kind of ['billing','pending','revoked','inactive','changed-role']){
    const id=await learner(),authority=await link(id,kind!=='billing',kind!=='pending');
    if(kind==='revoked')await post(`/guardian-links/${authority.id}/revoke`,{version:authority.version,reason:'Pickup rights ended'});
    if(kind==='inactive')await owner.query('UPDATE memberships SET revoked_at=now() WHERE id=$1',[members[2]]);
    if(kind==='changed-role')await owner.query("UPDATE memberships SET role='accountant' WHERE id=$1",[members[2]]);
    try{await post(`/collection/learners/${id}/release`,releaseBody(authority),404,desk);assert.equal((await owner.query('SELECT count(*) FROM collection_events WHERE learner_id=$1',[id])).rows[0].count,'0');}
    finally{await owner.query("UPDATE memberships SET role='guardian',revoked_at=NULL WHERE id=$1",[members[2]]);}
  }
});
test('release requires exact child, reviewed version and CSRF; concurrent retries create one immutable event',async()=>{
  const id=await learner(),authority=await link(id),wrong=await learner();
  await post(`/collection/learners/${wrong}/release`,releaseBody(authority),404,desk);await post(`/collection/learners/${id}/release`,{...releaseBody(authority),guardianLinkVersion:1},409,desk);
  await post(`/collection/learners/${id}/release`,{...releaseBody(authority),exceptionId:randomUUID(),exceptionVersion:1},400,desk);
  assert.equal((await call(`/collection/learners/${id}/release`,'POST',{operationId:randomUUID(),...releaseBody(authority)},{...desk,csrf:'invalid'})).status,403);
  const body={operationId:randomUUID(),...releaseBody(authority)};const [a,b]=await Promise.all([post(`/collection/learners/${id}/release`,body,201,desk),post(`/collection/learners/${id}/release`,body,201,desk)]);assert.deepEqual(a,b);assert.equal(a.events.length,1);assert.equal(a.events[0].date,date);assert.equal(a.events[0].guardian_link_version,authority.version);
  await post(`/collection/learners/${id}/release`,releaseBody(authority),409,desk);await post(`/collection/learners/${id}/release`,{...body,verificationReason:'Changed evidence'},409,desk);
  await assert.rejects(owner.query("UPDATE collection_events SET collector_name='Changed collector' WHERE id=$1",[a.events[0].id]),/immutable/);
});
test('unexpected pickup grants nothing until reviewed; approval is one-day, cancellable and head-only',async()=>{
  const id=await learner(),pending=await exception(id);
  await post(`/collection/learners/${id}/release`,exceptionalBody(pending),409,desk);
  await post(`/collection/cases/${pending.id}/review`,{version:1,action:'approve',reason:'Unauthorized desk approval',verificationReason:'Identity check'},403,desk);
  await post(`/collection/cases/${pending.id}/review`,{version:1,action:'approve',reason:'Missing identity check'},400);
  const approved=await approve(pending);await post(`/collection/cases/${pending.id}/review`,{version:1,action:'approve',reason:'Stale review',verificationReason:'Identity check'},409);
  const cancelled=await post(`/collection/cases/${approved.id}/review`,{version:approved.version,action:'cancel',reason:'Head withdrew mistaken one-time permission'});assert.equal(cancelled.cases[0].status,'cancelled');assert.equal(cancelled.cases[0].decision_reason,'Head reviewed one-time collection authority');await post(`/collection/learners/${id}/release`,exceptionalBody(approved),409,desk);
  const rejected=await exception(id);await post(`/collection/cases/${rejected.id}/review`,{version:1,action:'decline',reason:'Authority could not be verified'});await post(`/collection/learners/${id}/release`,exceptionalBody(rejected),409,desk);
  const expiredId=randomUUID();await owner.query("INSERT INTO collection_cases(id,school_id,learner_id,date,collector_name,request_reason,requested_by,status,reviewed_by,reviewed_at,decision_reason,review_verification) VALUES($1,$2,$3,$4::date-1,'Expired synthetic collector','Expired test',$5,'approved',$5,now(),'Reviewed past permission','Identity checked')",[expiredId,school,id,date,members[0]]);
  await post(`/collection/learners/${id}/release`,exceptionalBody({id:expiredId,version:1}),409,desk);
});
test('void records a correction, retains original evidence and never reopens used exception authority',async()=>{
  const id=await learner(),approved=await approve(await exception(id)),body={operationId:randomUUID(),...exceptionalBody(approved)};
  const released=await post(`/collection/learners/${id}/release`,body,201,desk),event=released.events[0];assert.equal(released.cases[0].status,'used');
  const frontdesk=await (await call(`/collection/learners/${id}`,'GET',undefined,desk)).json();assert.ok(!('review_verification' in frontdesk.cases[0]));
  await post(`/collection/events/${event.id}/void`,{version:1,reason:'Correct erroneous entry'},403,desk);
  const corrected=await post(`/collection/events/${event.id}/void`,{version:1,reason:'Recording correction; no claim of returned custody'});assert.equal(corrected.events[0].collector_name,event.collector_name);assert.ok(corrected.events[0].voided_at);assert.equal(corrected.cases[0].status,'used');
  await post(`/collection/learners/${id}/release`,{...body,operationId:randomUUID()},409,desk);
  await assert.rejects(owner.query('UPDATE collection_events SET void_reason=$1,version=version+1 WHERE id=$2',['Rewrite void history',event.id]),/immutable/);
  const fresh=await approve(await exception(id));const next=await post(`/collection/learners/${id}/release`,exceptionalBody(fresh),201,desk);assert.equal(next.events.length,2);assert.equal(next.events.filter((e:any)=>!e.voided_at).length,1);
});
test('withdrawn learner and revoked approving headteacher invalidate fresh releases',async()=>{
  const id=await learner(),authority=await link(id);await post(`/learners/${id}/withdraw`,{version:1,effectiveDate:date,reason:'Current-day departure'});
  await post(`/collection/learners/${id}/release`,releaseBody(authority),409,desk);const history=await (await call(`/collection/learners/${id}`)).json();assert.equal(history.learner.class_name,null);assert.equal(history.collectors.length,0);
  const second=await learner(),approved=await approve(await exception(second));await owner.query('UPDATE memberships SET revoked_at=now() WHERE id=$1',[members[0]]);
  try{await post(`/collection/learners/${second}/release`,exceptionalBody(approved),409,desk);}finally{await owner.query('UPDATE memberships SET revoked_at=NULL WHERE id=$1',[members[0]]);}
});
test('failed release audit rolls back event, consumed authority and receipt; identical retry succeeds',async()=>{
  const id=await learner(),approved=await approve(await exception(id)),body={operationId:randomUUID(),...exceptionalBody(approved)};
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_collection_failure CHECK(action<>'collection.released') NOT VALID");
  try{await post(`/collection/learners/${id}/release`,body,500,desk);assert.equal((await owner.query('SELECT status FROM collection_cases WHERE id=$1',[approved.id])).rows[0].status,'approved');assert.equal((await owner.query('SELECT count(*) FROM collection_events WHERE learner_id=$1',[id])).rows[0].count,'0');assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,body.operationId])).rows[0].count,'0');}finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_collection_failure');}
  assert.equal((await post(`/collection/learners/${id}/release`,body,201,desk)).cases[0].status,'used');
});
test('replayed commands recheck current role projection after a headteacher becomes front desk',async()=>{
  const id=await learner(),approved=await approve(await exception(id)),body={operationId:randomUUID(),...exceptionalBody(approved)};
  const initial=await post(`/collection/learners/${id}/release`,body);assert.ok(initial.cases[0].review_verification);
  await owner.query("UPDATE memberships SET role='frontdesk' WHERE id=$1",[members[0]]);
  try{const replay=await post(`/collection/learners/${id}/release`,body);assert.equal(replay.events[0].id,initial.events[0].id);assert.ok(replay.cases.every((c:any)=>!('review_verification' in c)));assert.equal((await owner.query('SELECT count(*) FROM collection_events WHERE learner_id=$1',[id])).rows[0].count,'1');}
  finally{await owner.query("UPDATE memberships SET role='headteacher' WHERE id=$1",[members[0]]);}
});
test('different concurrent release operations serialize to one active event',async()=>{
  const id=await learner(),authority=await link(id);const responses=await Promise.all([1,2].map(()=>call(`/collection/learners/${id}/release`,'POST',{operationId:randomUUID(),...releaseBody(authority)},desk)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);assert.equal((await owner.query('SELECT count(*) FROM collection_events WHERE learner_id=$1',[id])).rows[0].count,'1');
});
test('older history pages remain reachable while current active release remains visible',async()=>{
  const id=await learner(),authority=await link(id),first=await exception(id),second=await exception(id);
  await post(`/collection/learners/${id}/release`,releaseBody(authority),201,desk);
  const a=await (await call(`/collection/learners/${id}?limit=1`)).json(),b=await (await call(`/collection/learners/${id}?limit=1&offset=1`)).json();assert.equal(a.history.caseTotal,2);assert.equal(b.events.length,0);assert.ok(b.activeEvent);assert.equal(new Set([a.cases[0].id,b.cases[0].id]).size,2);assert.deepEqual(new Set([a.cases[0].id,b.cases[0].id]),new Set([first.id,second.id]));assert.equal((await call(`/collection/learners/${id}?limit=101`)).status,400);
});
test('historical learner lookup keeps departed collection records reachable without release eligibility',async()=>{
  const id=await learner(),authority=await link(id);await post(`/collection/learners/${id}/release`,releaseBody(authority),201,desk);
  await post(`/learners/${id}/withdraw`,{version:1,effectiveDate:date,reason:'Departed child retains collection evidence'});
  const number=(await owner.query('SELECT admission_number FROM learners WHERE id=$1',[id])).rows[0].admission_number;
  const current=await (await call(`/collection/learners?search=${number}`)).json(),historical=await (await call(`/collection/learners?history=true&search=${number}`)).json();assert.equal(current.total,0);assert.equal(historical.total,1);assert.equal(historical.items[0].id,id);assert.equal(historical.items[0].class_name,null);
  const detail=await (await call(`/collection/learners/${id}`)).json();assert.equal(detail.events.length,1);assert.equal(detail.collectors.length,0);await post(`/collection/learners/${id}/release`,{...releaseBody(authority),learnerVersion:2},409,desk);assert.equal((await call('/collection/learners?history=invalid')).status,400);
});
async function waitForBlockedBy(pid:number){
  for(let attempt=0;attempt<150;attempt++){
    const row=(await owner.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename='school_app' AND $1=ANY(pg_blocking_pids(pid))",[pid])).rows[0];if(row)return Number(row.pid);
    await new Promise(resolve=>setTimeout(resolve,20));
  }throw new Error('Expected database transaction blocker was not observed');
}
test('release and guardian revocation serialize both orderings without stale pickup authority',async()=>{
  for(const first of ['release','revoke']){
    const id=await learner(),authority=await link(id),blocker=await owner.connect();let pending:Promise<Response>|undefined,following:Promise<Response>|undefined;
    try{
      await blocker.query('BEGIN');await blocker.query('LOCK TABLE audit_events IN SHARE MODE');const pid=Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const release=()=>call(`/collection/learners/${id}/release`,'POST',{operationId:randomUUID(),...releaseBody(authority)},desk),revoke=()=>call(`/guardian-links/${authority.id}/revoke`,'POST',{operationId:randomUUID(),version:authority.version,reason:'Concurrent reviewed pickup revocation'});
      pending=first==='release'?release():revoke();const firstPid=await waitForBlockedBy(pid);following=first==='release'?revoke():release();await waitForBlockedBy(firstPid);await blocker.query('COMMIT');
      assert.equal((await pending).status,201);assert.equal((await following).status,first==='release'?201:404);assert.equal((await owner.query('SELECT count(*) FROM collection_events WHERE learner_id=$1',[id])).rows[0].count,first==='release'?'1':'0');
    }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;if(following)await following;}
  }
});
test('release and dated withdrawal serialize both orderings with preserved collection evidence',async()=>{
  for(const first of ['release','withdraw']){
    const id=await learner(),authority=await link(id),blocker=await owner.connect();let pending:Promise<Response>|undefined,following:Promise<Response>|undefined;
    try{
      await blocker.query('BEGIN');await blocker.query('LOCK TABLE audit_events IN SHARE MODE');const pid=Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const release=()=>call(`/collection/learners/${id}/release`,'POST',{operationId:randomUUID(),...releaseBody(authority)},desk),withdraw=()=>call(`/learners/${id}/withdraw`,'POST',{operationId:randomUUID(),version:1,effectiveDate:date,reason:'Concurrent reviewed withdrawal'});
      pending=first==='release'?release():withdraw();const firstPid=await waitForBlockedBy(pid);following=first==='release'?withdraw():release();await waitForBlockedBy(firstPid);await blocker.query('COMMIT');
      assert.equal((await pending).status,201);assert.equal((await following).status,first==='release'?201:409);assert.equal((await owner.query('SELECT count(*) FROM collection_events WHERE learner_id=$1',[id])).rows[0].count,first==='release'?'1':'0');
    }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;if(following)await following;}
  }
});
