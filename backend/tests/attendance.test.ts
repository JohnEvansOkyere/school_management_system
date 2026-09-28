import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),section=randomUUID(),teacherMembership=randomUUID(),headMembership=randomUUID();
const teacherUser='20000000-0000-4000-8000-000000000002',headUser='20000000-0000-4000-8000-000000000001';
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),date=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any,guardian:any,register:any,marks:any[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
function call(route:string,method='GET',body?:unknown,actor=head,target=school){return fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function post(route:string,body:Record<string,unknown>,status=201,actor=head,target=school){const r=await call(route,'POST',{operationId:body.operationId??randomUUID(),...body},actor,target);const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher,guardian]=await Promise.all(['head@example.test','teacher@example.test','guardian@example.test'].map(login));
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Attendance test school',other,'Other attendance school']);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher'),($4,$2,$5,'teacher')",[headMembership,school,headUser,teacherMembership,teacherUser]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Attendance year',$3,$4)",[year,school,date(-20),date(40)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Attendance class','Primary',20)",[section,school,year]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic attendance assignment',$7)",[randomUUID(),school,section,teacherMembership,date(-5),date(30),headMembership]);
  for(const [name,start] of [['Current attendance learner',date(-2)],['Future attendance learner',date(2)]] as const){const learner=randomUUID();await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`A-${learner.slice(0,8)}`,name]);await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,learner,section,start]);}
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});
test('attendance schema is forced RLS and no context reads nothing',async()=>{for(const table of ['school_days','attendance_registers','attendance_marks','attendance_corrections','attendance_roster_snapshots']){assert.equal((await runtime.query(`SELECT * FROM ${table}`)).rowCount,0);assert.equal((await runtime.query('SELECT relforcerowsecurity FROM pg_class WHERE relname=$1',[table])).rows[0].relforcerowsecurity,true);}});
test('school days are headteacher-controlled, date-bounded and retry-safe',async()=>{
  await post('/attendance/school-days',{day:today,isOpen:true,reason:'Synthetic school-open review'},403,teacher);const openOp=randomUUID();const opened=await post('/attendance/school-days',{operationId:openOp,day:today,isOpen:true,reason:'Synthetic school-open review'}),replay=await post('/attendance/school-days',{operationId:openOp,day:today,isOpen:true,reason:'Synthetic school-open review'});assert.deepEqual(replay,opened);
  await post('/attendance/school-days',{day:today,isOpen:false,reason:'Changed without current version'},409);await post('/attendance/school-days',{day:today,isOpen:false,reason:'Synthetic closure review',version:opened.version});
  await post('/attendance/school-days',{day:date(-30),isOpen:true,reason:'Outside academic year'},400);await post('/attendance/school-days',{day:today,isOpen:true,reason:'Synthetic reopen',version:opened.version},409);
  await post('/attendance/school-days',{day:today,isOpen:true,reason:'Synthetic reopen',version:opened.version+1});
});
test('open register derives current enrolments only and teacher scope is enforced',async()=>{
  const read=await (await call(`/attendance/classes/${section}/register?day=${today}`,'GET',undefined,teacher)).json();assert.equal(read.status,'draft');assert.equal(read.items.length,1);assert.equal(read.items[0].full_name,'Current attendance learner');assert.equal((await call(`/attendance/classes/${section}/register?day=${today}`,'GET',undefined,guardian)).status,404);assert.equal((await call(`/attendance/classes/${section}/register?day=${today}`,'GET',undefined,teacher,other)).status,404);assert.equal((await call(`/attendance/classes/${randomUUID()}/register?day=${today}`,'GET',undefined,teacher)).status,404);
  const closed=await post('/attendance/school-days',{day:date(1),isOpen:false,reason:'Synthetic weekend closure'});assert.equal(closed.is_open,false);assert.equal((await call(`/attendance/classes/${section}/register?day=${date(1)}`,'GET',undefined,teacher)).status,409);
});
test('draft save, submit, lock and correction preserve versions, reasons and retries',async()=>{
  const read=await (await call(`/attendance/classes/${section}/register?day=${today}`,'GET',undefined,teacher)).json();marks=read.items.map((row:any)=>({learnerId:row.id,mark:'present'}));const saveOp=randomUUID();register=await post(`/attendance/classes/${section}/register`,{operationId:saveOp,day:today,version:0,action:'save',marks},201,teacher);assert.equal(register.status,'draft');assert.equal((await post(`/attendance/classes/${section}/register`,{operationId:saveOp,day:today,version:0,action:'save',marks},201,teacher)).id,register.id);
  const draftEdits=marks.map(row=>({...row,mark:'late'}));register=await post(`/attendance/classes/${section}/register`,{day:today,version:register.version,action:'save',marks:draftEdits},201,teacher);assert.equal((await owner.query('SELECT count(*) FROM attendance_corrections WHERE school_id=$1 AND register_id=$2',[school,register.id])).rows[0].count,'0');marks=draftEdits;
  await post(`/attendance/classes/${section}/register`,{day:today,version:0,action:'submit',marks},409,teacher);register=await post(`/attendance/classes/${section}/register`,{day:today,version:register.version,action:'submit',marks},201,teacher);assert.equal(register.status,'submitted');
  const correctionMarks=marks.map(row=>({...row,mark:'absent'}));const corrected=await post(`/attendance/classes/${section}/register`,{day:today,version:register.version,action:'correct',marks:correctionMarks,correctionReason:'Synthetic reviewed late-arrival correction'},201,teacher);assert.equal(corrected.status,'submitted');await post(`/attendance/classes/${section}/register`,{day:today,version:register.version,action:'correct',marks:correctionMarks,correctionReason:'Synthetic reviewed late-arrival correction'},409,teacher);
  register=await post(`/attendance/classes/${section}/register`,{day:today,version:corrected.version,action:'lock',marks:correctionMarks},201,head);assert.equal(register.status,'locked');await post(`/attendance/classes/${section}/register`,{day:today,version:register.version,action:'correct',marks:marks,correctionReason:'Teacher cannot correct locked record'},403,teacher);
  const finalMarks=marks.map(row=>({...row,mark:'excused'}));const final=await post(`/attendance/classes/${section}/register`,{day:today,version:register.version,action:'correct',marks:finalMarks,correctionReason:'Headteacher reviewed locked correction'},201,head);assert.equal(final.status,'locked');assert.equal((await owner.query('SELECT count(*) FROM attendance_corrections WHERE school_id=$1 AND register_id=$2',[school,register.id])).rows[0].count,'2');
  const schoolDay=(await owner.query('SELECT version FROM school_days WHERE school_id=$1 AND day=$2',[school,today])).rows[0];await post('/attendance/school-days',{day:today,isOpen:false,reason:'Synthetic archive after attendance',version:schoolDay.version});
  const snapshot=(await owner.query('SELECT learner_id,enrolment_id FROM attendance_roster_snapshots WHERE school_id=$1 AND register_id=$2',[school,register.id])).rows[0];await owner.query("UPDATE enrolments SET end_date=$1,end_reason='Synthetic backdated withdrawal' WHERE school_id=$2 AND id=$3",[date(-1),school,snapshot.enrolment_id]);
  const laterLearner=randomUUID();await owner.query('INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)',[laterLearner,school,`A-${laterLearner.slice(0,8)}`,'Later historical enrolment']);await owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),school,laterLearner,section,date(-10)]);
  const frozen=await (await call(`/attendance/classes/${section}/register?day=${today}`,'GET',undefined,head)).json();assert.equal(frozen.status,'locked');assert.equal(frozen.items.length,1);assert.equal(frozen.items[0].id,snapshot.learner_id);assert.equal(frozen.items[0].full_name,'Current attendance learner');assert.equal(frozen.items[0].mark,'excused');
});
test('marks are complete, unmarked is explicit, stale edits conflict and correction history is append-only',async()=>{
  const read=await (await call(`/attendance/classes/${section}/register?day=${today}`,'GET',undefined,head)).json();assert.equal(read.items[0].mark,'excused');assert.equal((await call(`/attendance/classes/${section}/register`,'POST',{operationId:randomUUID(),day:today,version:read.version,action:'save',marks:[]},head)).status,409);
  assert.equal((await owner.query('SELECT count(*) FROM attendance_registers WHERE school_id=$1 AND id=$2',[school,register.id])).rows[0].count,'1');assert.equal((await owner.query('SELECT count(*) FROM attendance_corrections WHERE school_id=$1 AND register_id=$2',[school,register.id])).rows[0].count,'2');
});
test('locked corrections retain captured membership after a backdated withdrawal and admission',async()=>{
  const read=await (await call(`/attendance/classes/${section}/register?day=${today}`)).json();
  const corrected=await post(`/attendance/classes/${section}/register`,{day:today,version:read.version,action:'correct',marks:read.items.map((row:any)=>({learnerId:row.id,mark:'present'})),correctionReason:'Reviewed historical attendance evidence'});
  assert.equal(corrected.status,'locked');
  const reloaded=await (await call(`/attendance/classes/${section}/register?day=${today}`)).json();assert.equal(reloaded.items.length,1);assert.equal(reloaded.items[0].id,read.items[0].id);assert.equal(reloaded.items[0].mark,'present');
  const later=(await owner.query("SELECT id FROM learners WHERE school_id=$1 AND full_name='Later historical enrolment'",[school])).rows[0].id;
  await post(`/attendance/classes/${section}/register`,{day:today,version:reloaded.version,action:'correct',marks:[{learnerId:later,mark:'absent'}],correctionReason:'Cannot replace captured roster'},400);
  assert.equal((await owner.query('SELECT count(*) FROM attendance_marks WHERE school_id=$1 AND register_id=$2 AND learner_id=$3',[school,reloaded.id,later])).rows[0].count,'0');
});
