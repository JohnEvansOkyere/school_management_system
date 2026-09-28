import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const owner=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:'school_saas_local',user:process.env.USER});
const runtime=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:'school_saas_local',user:'school_app'});
const school=randomUUID(),other=randomUUID(),members=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
const users=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
let app:any,base:string,account:{cookie:string;csrf:string},year:any,section:any,destination:any;
async function login(email='head@example.test') {
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(response.status,201);
  return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};
}
async function call(url:string,method='GET',body?:unknown,actor=account) {return fetch(`${base}/schools/${school}${url}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function post(url:string,body:Record<string,unknown>,expected=201,actor=account){const response=await call(url,'POST',{operationId:randomUUID(),...body},actor);const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
async function apply(classId=section.id,name='Synthetic learner',startDate='2026-09-01'){return post('/admissions',{fullName:name,classId,startDate,admissionNumber:`S-${randomUUID().slice(0,12)}`});}
async function accepted(classId=section.id,startDate='2026-09-01'){let application=await apply(classId,'Synthetic learner',startDate);for(const action of ['review','offer','accept'])application=await post(`/admissions/${application.id}/transition`,{version:application.version,action});return application;}
async function enrolled(classId=section.id){const application=await accepted(classId);return post(`/admissions/${application.id}/transition`,{version:application.version,action:'enrol'});}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;account=await login();
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Admissions test school',other,'Separate test school']);
  for(let i=0;i<4;i++)await owner.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',[members[i],school,users[i],['headteacher','teacher','guardian','frontdesk'][i]]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[randomUUID(),other,users[0]]);
  year=await post('/academic-years',{name:'2026/2027',startDate:'2026-09-01',endDate:'2027-08-01'});
  section=await post('/classes',{name:'Primary 1 Blue',level:'Primary',capacity:50,academicYearId:year.id});
  destination=await post('/classes',{name:'Primary 1 Green',level:'Primary',capacity:50,academicYearId:year.id});
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});
test('admissions schema forces RLS and no-context reads deny',async()=>{
  const tables=(await runtime.query("SELECT relname,relforcerowsecurity FROM pg_class WHERE relname IN ('command_receipts','academic_years','class_sections','learners','admissions','enrolments')")).rows;assert.equal(tables.length,6);assert.ok(tables.every(row=>row.relforcerowsecurity));
  for(const name of ['academic_years','class_sections','learners','admissions','enrolments'])assert.equal((await runtime.query(`SELECT * FROM ${name}`)).rowCount,0);
});
test('calendar creation is retry safe and operation IDs bind exact payload',async()=>{
  const body={operationId:randomUUID(),name:'2027/2028',startDate:'2027-08-01',endDate:'2028-08-01'};
  const a=await post('/academic-years',body),b=await post('/academic-years',body);assert.equal(a.id,b.id);
  await post('/academic-years',{...body,name:'Changed request'},409);
  await post('/academic-years',{name:'Invalid bounds',startDate:'2027-08-01',endDate:'2027-08-01'},400);
  await post('/academic-years',{name:'Invalid date',startDate:'2027-02-30',endDate:'2027-08-01'},400);
});
test('classes and applications reject invalid and cross-school references',async()=>{
  await post('/classes',{name:'Unknown year',level:'Primary',capacity:1,academicYearId:randomUUID()},404);
  await post('/classes',{name:'Invalid level',level:'SHS',capacity:1,academicYearId:year.id},400);
  const response=await fetch(`${base}/schools/${other}/admissions`,{method:'POST',headers:{cookie:account.cookie,'content-type':'application/json','x-csrf-token':account.csrf},body:JSON.stringify({operationId:randomUUID(),fullName:'Cross school learner',classId:section.id,startDate:'2026-09-01',admissionNumber:'CROSS-1'})});assert.equal(response.status,404);
  await post('/admissions',{fullName:'Invalid birth',dateOfBirth:'2026-09-02',classId:section.id,startDate:'2026-09-01',admissionNumber:'DOB-1'},400);
  await post('/admissions',{fullName:'Outside year',classId:section.id,startDate:'2027-08-01',admissionNumber:'DATE-1'},400);
});
test('duplicate requests create one application and one audit record',async()=>{
  const body={operationId:randomUUID(),fullName:'Retry learner',classId:section.id,startDate:'2026-09-01',admissionNumber:`R-${randomUUID().slice(0,12)}`};
  const [a,b]=await Promise.all([post('/admissions',body),post('/admissions',body)]);assert.equal(a.id,b.id);
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='admission.created'",[a.id])).rows[0].count,'1');
  await post('/admissions',{...body,operationId:randomUUID()},409);
});
test('teacher and guardian roles cannot inspect admissions or unscoped learners',async()=>{
  for(const email of ['teacher@example.test','guardian@example.test']){const actor=await login(email);for(const route of ['/admissions','/learners','/classes'])assert.equal((await call(route,'GET',undefined,actor)).status,403);}
});
test('review decisions require valid workflow, version and decision reasons',async()=>{
  const application=await apply();await post(`/admissions/${application.id}/transition`,{version:1,action:'enrol'},409);
  const review=await post(`/admissions/${application.id}/transition`,{version:1,action:'review'});
  await post(`/admissions/${application.id}/transition`,{version:1,action:'offer'},409);
  await post(`/admissions/${application.id}/transition`,{version:review.version,action:'waitlist'},400);
  const waitlist=await post(`/admissions/${application.id}/transition`,{version:review.version,action:'waitlist',reason:'Awaiting reviewed space'});assert.equal(waitlist.status,'waitlisted');
  const offer=await post(`/admissions/${application.id}/transition`,{version:waitlist.version,action:'offer',reason:'A reviewed space is now available'});assert.equal(offer.status,'offered');
  const priorReason=(await owner.query("SELECT metadata->>'reason' AS reason FROM audit_events WHERE target_id=$1 AND action='admission.waitlisted'",[application.id])).rows[0].reason;assert.equal(priorReason,'Awaiting reviewed space');
});
test('enrolment is atomic and retry-safe without silently creating identity',async()=>{
  const countBefore=(await owner.query('SELECT count(*) FROM users')).rows[0].count;
  const application=await accepted();const body={operationId:randomUUID(),version:application.version,action:'enrol'};
  const a=await post(`/admissions/${application.id}/transition`,body),b=await post(`/admissions/${application.id}/transition`,body);assert.equal(a.learner_id,b.learner_id);
  assert.equal((await owner.query('SELECT count(*) FROM enrolments WHERE school_id=$1 AND learner_id=$2',[school,a.learner_id])).rows[0].count,'1');
  assert.equal((await owner.query('SELECT count(*) FROM users')).rows[0].count,countBefore);
});
test('failed audit rolls back learner, enrolment and application state',async()=>{
  const application=await accepted();const body={operationId:randomUUID(),version:application.version,action:'enrol'};
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_admission_failure CHECK(action<>'admission.enrolled') NOT VALID");
  try {
    await post(`/admissions/${application.id}/transition`,body,500);
    const current=(await owner.query('SELECT status,version,learner_id FROM admissions WHERE id=$1',[application.id])).rows[0];assert.deepEqual(current,{status:'accepted',version:application.version,learner_id:null});
    assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,body.operationId])).rows[0].count,'0');
  }finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_admission_failure');}
});
test('concurrent enrolments cannot exceed capacity; headteacher override is audited',async()=>{
  const limited=await post('/classes',{name:'Capacity one',level:'Primary',capacity:1,academicYearId:year.id});
  const applications=[await accepted(limited.id),await accepted(limited.id)];
  const responses=await Promise.all(applications.map(a=>call(`/admissions/${a.id}/transition`,'POST',{operationId:randomUUID(),version:a.version,action:'enrol'})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const blocked=applications[responses.findIndex(r=>r.status===409)];
  const frontdesk=await login('frontdesk@example.test');await post(`/admissions/${blocked.id}/transition`,{version:blocked.version,action:'enrol',capacityOverrideReason:'Reviewed exceptional space'},403,frontdesk);
  const result=await post(`/admissions/${blocked.id}/transition`,{version:blocked.version,action:'enrol',capacityOverrideReason:'Headteacher reviewed exceptional space'});assert.equal(result.status,'enrolled');
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE school_id=$1 AND action='class.capacity.override' AND target_id=$2",[school,limited.id])).rows[0].count,'1');
});
test('transfer preserves dated history and replay creates no duplicate enrolment',async()=>{
  const enrolledRecord=await enrolled();const body={operationId:randomUUID(),version:1,classId:destination.id,effectiveDate:'2026-10-01',reason:'Reviewed mid-term class transfer'};
  const result=await post(`/learners/${enrolledRecord.learner_id}/transfer`,body);assert.equal(result.version,2);assert.equal(result.enrolments.length,2);assert.equal(result.enrolments[0].end_date,'2026-10-01');assert.equal(result.enrolments[1].start_date,'2026-10-01');assert.equal(result.enrolments[0].class_name,section.name);
  const replay=await post(`/learners/${enrolledRecord.learner_id}/transfer`,body);assert.equal(replay.enrolments.length,2);
  await post(`/learners/${enrolledRecord.learner_id}/transfer`,{...body,operationId:randomUUID(),classId:section.id},409);
  const fresh=await (await call(`/learners/${enrolledRecord.learner_id}`)).json();assert.deepEqual(fresh,result);
});
test('invalid transfer or full destination rolls back original history',async()=>{
  const record=await enrolled();const full=await post('/classes',{name:'Full destination',level:'Primary',capacity:1,academicYearId:year.id});await enrolled(full.id);
  await post(`/learners/${record.learner_id}/transfer`,{version:1,classId:full.id,effectiveDate:'2026-10-01',reason:'Cannot fit'},409);
  await post(`/learners/${record.learner_id}/transfer`,{version:1,classId:destination.id,effectiveDate:'2026-09-01',reason:'Invalid start'},400);
  const fresh=await (await call(`/learners/${record.learner_id}`)).json();assert.equal(fresh.version,1);assert.equal(fresh.enrolments.length,1);assert.equal(fresh.enrolments[0].end_date,null);
});
test('database rejects overlapping enrolments and edits to closed history',async()=>{
  const record=await enrolled();const moved=await post(`/learners/${record.learner_id}/transfer`,{version:1,classId:destination.id,effectiveDate:'2026-10-01',reason:'History constraint check'});
  await assert.rejects(owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),school,record.learner_id,section.id,'2026-09-15']),/exclusion constraint/);
  await assert.rejects(owner.query('UPDATE enrolments SET end_date=NULL,end_reason=NULL WHERE id=$1',[moved.enrolments[0].id]),/immutable/);
});
test('bounded search pagination returns all applications without leaking another school',async()=>{
  const prefix=`Page-${randomUUID().slice(0,8)}`;
  for(let i=0;i<3;i++)await apply(section.id,`${prefix} learner ${i}`);
  const first=await (await call(`/admissions?limit=2&search=${prefix}`)).json();const second=await (await call(`/admissions?limit=2&offset=2&search=${prefix}`)).json();
  assert.equal(first.total,3);assert.equal(first.items.length,2);assert.equal(second.items.length,1);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,3);
  const literal=await (await call('/admissions?search=%25')).json();assert.equal(literal.total,0);
  assert.equal((await call('/admissions?limit=1000')).status,400);assert.equal((await call('/learners?offset=-1')).status,400);
});
test('future arrivals reserve capacity and same-date departures release it',async()=>{
  const target=await post('/classes',{name:'Scheduled capacity',level:'Primary',capacity:1,academicYearId:year.id});
  const incoming=await enrolled();await post(`/learners/${incoming.learner_id}/transfer`,{version:1,classId:target.id,effectiveDate:'2026-10-01',reason:'Scheduled incoming transfer'});
  const tooEarly=await accepted(target.id);await post(`/admissions/${tooEarly.id}/transition`,{version:tooEarly.version,action:'enrol'},409);
  await post(`/learners/${incoming.learner_id}/transfer`,{version:2,classId:destination.id,effectiveDate:'2026-11-01',reason:'Scheduled departure'});
  const replacement=await accepted(target.id,'2026-11-01');const success=await post(`/admissions/${replacement.id}/transition`,{version:replacement.version,action:'enrol'});assert.equal(success.status,'enrolled');
});
test('database composite foreign keys reject cross-school learner/class links',async()=>{
  const learner=await enrolled();await assert.rejects(owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),other,learner.learner_id,section.id,'2026-09-01']),/foreign key/);
});
