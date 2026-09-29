import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),busy=randomUUID(),quiet=randomUUID(),headMembership=randomUUID(),teacherMembership=randomUUID();
const headUser='20000000-0000-4000-8000-000000000001',teacherUser='20000000-0000-4000-8000-000000000002';
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),date=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
let app:any,base:string,head:any,teacher:any;const learners:string[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
function call(route:string,method='GET',body?:unknown,actor=head){return fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function post(route:string,body:Record<string,unknown>,actor=head){const r=await call(route,'POST',{operationId:randomUUID(),...body},actor);const value=await r.json();assert.equal(r.status,201,JSON.stringify(value));return value;}
async function submit(classId:string,day:string,marks:{learnerId:string;mark:string}[]){const draft=await post(`/attendance/classes/${classId}/register`,{day,version:0,action:'save',marks},teacher);return post(`/attendance/classes/${classId}/register`,{day,version:draft.version,action:'submit',marks},teacher);}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher]=await Promise.all(['head@example.test','teacher@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Follow-up school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher'),($4,$2,$5,'teacher')",[headMembership,school,headUser,teacherMembership,teacherUser]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Follow-up year',$3,$4)",[year,school,date(-20),date(40)]);
  for(const [id,name] of [[busy,'Follow-up Busy Class'],[quiet,'Follow-up Quiet Class']])await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,'Primary',20)",[id,school,year,name]);
  await owner.query("INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,'Kofi Sample',$5,$6,'Synthetic follow-up assignment',$7)",[randomUUID(),school,busy,teacherMembership,date(-10),date(30),headMembership]);
  for(const [name,classId] of [['Often Absent Learner',busy],['Always Present Learner',busy],['Quiet Class Learner',quiet]] as const){
    const learner=randomUUID();learners.push(learner);
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`F-${learner.slice(0,8)}`,name]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)",[randomUUID(),school,learner,classId,date(-15)]);
  }
  for(const day of [today,date(-1),date(-2),date(-3)])await post('/attendance/school-days',{day,isOpen:true,reason:'Synthetic follow-up open day'});
});
after(async()=>{await app?.close();await owner.end();});

test('follow-up shows outstanding registers and is headteacher-only',async()=>{
  assert.equal((await call('/attendance/follow-up','GET',undefined,teacher)).status,403);
  const before=await (await call('/attendance/follow-up')).json();
  assert.equal(before.open,true);assert.equal(before.outstanding,2);
  assert.deepEqual(before.classes.map((row:any)=>[row.name,row.register_status,row.learners]),[['Follow-up Busy Class','missing',2],['Follow-up Quiet Class','missing',1]]);
  await submit(busy,today,[{learnerId:learners[0],mark:'present'},{learnerId:learners[1],mark:'present'}]);
  const after=await (await call('/attendance/follow-up')).json();
  assert.equal(after.outstanding,1);assert.equal(after.classes.find((row:any)=>row.name==='Follow-up Busy Class').register_status,'submitted');
  const closed=await (await call(`/attendance/follow-up?day=${date(-9)}`)).json();assert.deepEqual([closed.open,closed.classes.length],[false,0]);
  assert.equal((await call('/attendance/follow-up?day=2026-02-30')).status,400);
});

test('repeated absence lists learners at or above the threshold from submitted registers only',async()=>{
  for(const day of [date(-1),date(-2),date(-3)])await submit(busy,day,[{learnerId:learners[0],mark:'absent'},{learnerId:learners[1],mark:'present'}]);
  assert.equal((await call('/attendance/repeated-absence','GET',undefined,teacher)).status,403);
  const result=await (await call('/attendance/repeated-absence?days=14&threshold=3')).json();
  assert.equal(result.total,1);assert.equal(result.items[0].full_name,'Often Absent Learner');assert.equal(result.items[0].absences,3);assert.equal(result.items[0].class_name,'Follow-up Busy Class');assert.equal(result.items[0].last_absent_day,date(-1));
  assert.equal((await (await call('/attendance/repeated-absence?days=14&threshold=4')).json()).total,0);
  assert.equal((await (await call(`/attendance/repeated-absence?days=2&threshold=3&to=${today}`)).json()).total,0);
  assert.equal((await call('/attendance/repeated-absence?threshold=1')).status,400);
});
