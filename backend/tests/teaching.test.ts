import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),section=randomUUID(),unassigned=randomUUID(),futureClass=randomUUID(),expiredClass=randomUUID();
const users=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
const members=users.map(()=>randomUUID()),otherTeacher=randomUUID();
const today=new Date().toISOString().slice(0,10),day=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any,guardian:any,desk:any,grant:any;
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
function call(route:string,method='GET',body?:unknown,actor=head,target=school){return fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function post(route:string,body:Record<string,unknown>,status=201,actor=head,target=school){const r=await call(route,'POST',{operationId:randomUUID(),...body},actor,target);const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
const payload=(classId=section,startDate=day(-20),endDate=day(100))=>({classId,teacherMembershipId:members[1],startDate,endDate,reason:'Reviewed synthetic whole-class teaching responsibility'});
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian,desk]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test','frontdesk@example.test'].map(login));
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Teaching test school',other,'Other teaching school']);
  for(let i=0;i<4;i++)await owner.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',[members[i],school,users[i],['headteacher','teacher','guardian','frontdesk'][i]]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'teacher'),($4,$2,$5,'headteacher')",[otherTeacher,other,users[1],randomUUID(),users[0]]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Teaching year',$3,$4)",[year,school,day(-100),day(300)]);
  for(const [id,name] of [[section,'Scoped class'],[unassigned,'Unassigned class'],[futureClass,'Future class'],[expiredClass,'Expired class']])await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,'Primary',50)",[id,school,year,name]);
  for(const [name,start,end,superseded] of [['Eligible learner',day(-10),null,false],['Late admission',day(1),null,false],['Left yesterday',day(-20),today,false],['Superseded learner',day(-10),null,true],['Eligible second',day(-5),null,false]] as const){
    const id=randomUUID();await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name,date_of_birth) VALUES($1,$2,$3,$4,'2018-05-03')",[id,school,`T-${id.slice(0,8)}`,name]);
    await owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date,end_date,end_reason,superseded_at,supersession_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),school,id,section,start,end,end?'Reviewed departure':null,superseded?new Date():null,superseded?'Superseded reservation':null]);
  }
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});
test('teaching schema and candidate function fail closed outside authorized head context',async()=>{
  assert.equal((await runtime.query('SELECT * FROM teaching_assignments')).rowCount,0);assert.equal((await runtime.query("SELECT relforcerowsecurity FROM pg_class WHERE relname='teaching_assignments'")).rows[0].relforcerowsecurity,true);
  assert.deepEqual(await (await call('/teacher-candidates')).json(),[{id:members[1],display_name:'Kofi Sample'}]);
  const client=await runtime.connect();try{await client.query('BEGIN');await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.school_id',$2,true)",[users[1],school]);assert.equal((await client.query('SELECT * FROM teacher_candidates($1)',[school])).rowCount,0);
    await client.query("SELECT set_config('app.user_id',$1,true)",[users[0]]);assert.equal((await client.query('SELECT * FROM teacher_candidates($1)',[other])).rowCount,0);
  }finally{await client.query('ROLLBACK');client.release();}
});
test('assignment commands require head authority, live teacher and tenant/year/date validation',async()=>{
  for(const actor of [teacher,guardian,desk]){await post('/teaching/assignments',payload(),403,actor);assert.equal((await call('/teacher-candidates','GET',undefined,actor)).status,403);}
  await post('/teaching/assignments',{...payload(),teacherMembershipId:otherTeacher},404);await post('/teaching/assignments',{...payload(),teacherMembershipId:members[2]},404);
  await post('/teaching/assignments',payload(randomUUID()),404);await post('/teaching/assignments',payload(section,day(-101)),400);await post('/teaching/assignments',payload(section,today,today),400);
  await post('/teaching/assignments',{...payload(),reason:''},400);await post('/teaching/assignments',{...payload(),startDate:'2026-02-30'},400);
  await owner.query('UPDATE memberships SET revoked_at=now() WHERE id=$1',[members[1]]);try{await post('/teaching/assignments',payload(),404);}finally{await owner.query('UPDATE memberships SET revoked_at=NULL WHERE id=$1',[members[1]]);}
});
test('assignment replay is atomic and overlap concurrency grants exactly once',async()=>{
  const body={operationId:randomUUID(),...payload()};grant=await post('/teaching/assignments',body);assert.deepEqual(await post('/teaching/assignments',body),grant);
  await post('/teaching/assignments',{...body,reason:'Changed payload'},409);
  const replies=await Promise.all([call('/teaching/assignments','POST',{operationId:randomUUID(),...payload(unassigned)}),call('/teaching/assignments','POST',{operationId:randomUUID(),...payload(unassigned)})]);assert.deepEqual(replies.map(row=>row.status).sort(),[201,409]);
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action='teaching.assignment.created'",[grant.id])).rows[0].count,'1');
});
test('teacher rosters include only effective eligible learners and minimal fields with correct paging',async()=>{
  const list=await (await call(`/teaching/classes?date=${today}`,'GET',undefined,teacher)).json();assert.equal(list.total,2);assert.ok(list.items.every(row=>[section,unassigned].includes(row.id)));
  const a=await (await call(`/teaching/classes/${section}/roster?date=${today}&limit=1`,'GET',undefined,teacher)).json(),b=await (await call(`/teaching/classes/${section}/roster?date=${today}&limit=1&offset=1`,'GET',undefined,teacher)).json();assert.equal(a.total,2);assert.equal(a.items.length,1);assert.equal(b.items.length,1);assert.notEqual(a.items[0].id,b.items[0].id);
  for(const child of [...a.items,...b.items])assert.deepEqual(Object.keys(child).sort(),['admission_number','enrolment_id','full_name','id']);
  const yesterday=await (await call(`/teaching/classes/${section}/roster?date=${day(-1)}`,'GET',undefined,teacher)).json();assert.equal(yesterday.total,3);
  const tomorrow=await (await call(`/teaching/classes/${section}/roster?date=${day(1)}`,'GET',undefined,teacher)).json();assert.equal(tomorrow.total,3);
  assert.equal((await call(`/teaching/classes/${section}/roster?date=${day(-21)}`,'GET',undefined,teacher)).status,404);
  assert.equal((await call(`/teaching/classes/${section}/roster?date=${day(100)}`,'GET',undefined,teacher)).status,404);
  const literal=await (await call(`/teaching/classes/${section}/roster?date=${today}&search=%25`,'GET',undefined,teacher)).json();assert.equal(literal.total,0);
});
test('future and expired assignments do not grant access even to requested dates within their ranges',async()=>{
  await post('/teaching/assignments',payload(futureClass,day(5),day(100)));await post('/teaching/assignments',payload(expiredClass,day(-80),today));
  for(const [id,date] of [[futureClass,day(5)],[expiredClass,day(-10)]])assert.equal((await call(`/teaching/classes/${id}/roster?date=${date}`,'GET',undefined,teacher)).status,404);
  assert.equal((await call(`/teaching/classes/${randomUUID()}/roster?date=${today}`,'GET',undefined,teacher)).status,404);
  assert.equal((await call(`/teaching/classes/${section}/roster?date=${today}`,'GET',undefined,teacher,other)).status,404);
  for(const actor of [guardian,desk])assert.equal((await call(`/teaching/classes/${section}/roster?date=${today}`,'GET',undefined,actor)).status,403);
});
test('revocation denies the same teacher session, preserves history and supports distinct regrant',async()=>{
  const body={operationId:randomUUID(),version:1,reason:'Reviewed synthetic teaching scope revoked'};const revoked=await post(`/teaching/assignments/${grant.id}/revoke`,body);assert.deepEqual(await post(`/teaching/assignments/${grant.id}/revoke`,body),revoked);
  assert.equal((await call(`/teaching/classes/${section}/roster?date=${today}`,'GET',undefined,teacher)).status,404);
  await assert.rejects(owner.query('UPDATE teaching_assignments SET revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL WHERE id=$1',[grant.id]),/immutable/);
  await assert.rejects(owner.query('UPDATE teaching_assignments SET start_date=$1 WHERE id=$2',[day(-40),grant.id]),/immutable/);
  grant=await post('/teaching/assignments',payload());assert.equal((await call(`/teaching/classes/${section}/roster?date=${today}`,'GET',undefined,teacher)).status,200);
  try{await owner.query("UPDATE memberships SET role='guardian' WHERE id=$1",[members[1]]);assert.equal((await call(`/teaching/classes/${section}/roster?date=${today}`,'GET',undefined,teacher)).status,403);
    const history=await (await call('/teaching/assignments?search=Scoped%20class')).json();assert.ok(history.items.every(row=>row.teacher_display_name==='Kofi Sample'));
  }finally{await owner.query("UPDATE memberships SET role='teacher' WHERE id=$1",[members[1]]);}
});
test('failed assignment audit rolls back grant and receipt; paged history remains reachable',async()=>{
  const body={operationId:randomUUID(),...payload(futureClass,day(101),day(200))};await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_teaching_failure CHECK(action<>'teaching.assignment.created') NOT VALID");
  try{await post('/teaching/assignments',body,500);assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,body.operationId])).rows[0].count,'0');assert.equal((await owner.query('SELECT count(*) FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND start_date=$3',[school,futureClass,body.startDate])).rows[0].count,'0');}
  finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_teaching_failure');}
  await post('/teaching/assignments',body);
  const a=await (await call('/teaching/assignments?limit=2')).json(),b=await (await call('/teaching/assignments?limit=2&offset=2')).json();assert.ok(a.total>4);assert.equal(a.items.length,2);assert.equal(new Set([...a.items,...b.items].map(row=>row.id)).size,4);
  assert.equal((await call('/teaching/class-options?limit=1000')).status,400);assert.equal((await call('/teaching/classes?date=2026-02-30','GET',undefined,teacher)).status,400);
  await assert.rejects(owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Cross school',$5,$6,'Synthetic grant',$7)",[randomUUID(),other,section,otherTeacher,day(-10),day(100),members[0]]),/foreign key/);
});
