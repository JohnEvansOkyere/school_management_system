import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const {AttendanceService}=require('../dist/modules/attendance/attendance.service');
const {LearnersService}=require('../dist/modules/learners/learners.service');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const school=randomUUID(),other=randomUUID(),year=randomUUID(),section=randomUUID(),member=randomUUID(),learner=randomUUID(),interval=randomUUID(),foreignLearner=randomUUID();
const user='20000000-0000-4000-8000-000000000001';
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}),day=(delta:number)=>new Date(Date.parse(`${today}T00:00:00Z`)+delta*86400000).toISOString().slice(0,10);
const actor={schoolId:school,membershipId:member,userId:user,role:'headteacher'};
let app:any,base:string,cookie:string,csrf:string;
async function call(route:string,body?:Record<string,unknown>){return fetch(`${base}/schools/${school}${route}`,{method:body?'POST':'GET',headers:{cookie,'content-type':'application/json','x-csrf-token':csrf},...(body?{body:JSON.stringify({operationId:randomUUID(),...body})}:{})});}
async function post(route:string,body:Record<string,unknown>,status=201){const response=await call(route,body),value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
async function read(classId=section,date=today){const response=await call(`/attendance/classes/${classId}/register?day=${date}`);assert.equal(response.status,200);return response.json();}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'head@example.test',password:'Synthetic-only-2026!'})});assert.equal(login.status,201);cookie=login.headers.get('set-cookie')!.split(';')[0];csrf=(await login.json()).csrfToken;
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Attendance integrity school',other,'Foreign integrity school']);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'headteacher')",[member,school,user]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Integrity year',$3,$4)",[year,school,day(-20),day(40)]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Integrity class','Primary',20)",[section,school,year]);
  await owner.query('INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[learner,school,'INTEGRITY-1','Integrity learner',foreignLearner,other,'FOREIGN-1','Foreign learner']);
  await owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[interval,school,learner,section,day(-5)]);
  await post('/attendance/school-days',{day:today,isOpen:true,reason:'Reviewed synthetic integrity day'});
});
after(async()=>{await app?.close();await runtime.end();await owner.end();});

test('finalized roster rejects omitted, extra, duplicate and cross-school marks without changing history',async()=>{
  const marks=[{learnerId:learner,mark:'present'}];const draft=await post(`/attendance/classes/${section}/register`,{day:today,version:0,action:'save',marks});const submitted=await post(`/attendance/classes/${section}/register`,{day:today,version:draft.version,action:'submit',marks});
  for(const invalid of [[],[...marks,...marks],[...marks,{learnerId:foreignLearner,mark:'absent'}],[{learnerId:foreignLearner,mark:'late'}]])await post(`/attendance/classes/${section}/register`,{day:today,version:submitted.version,action:'correct',marks:invalid,correctionReason:'Invalid roster must be rejected'},400);
  const unchanged=await read();assert.equal(unchanged.version,submitted.version);assert.equal(unchanged.rosterSource,'submission');assert.equal(unchanged.items[0].mark,'present');assert.equal((await owner.query('SELECT count(*) FROM attendance_corrections WHERE register_id=$1',[submitted.id])).rows[0].count,'0');
  const locked=await post(`/attendance/classes/${section}/register`,{day:today,version:submitted.version,action:'lock',marks});assert.equal(locked.status,'locked');
});

test('runtime cannot rewrite or extend finalized roster/provenance',async()=>{
  const view=await read(),client=await runtime.connect();
  try{
    for(const sql of ['UPDATE attendance_roster_snapshots SET full_name=full_name','DELETE FROM attendance_roster_snapshots']){
      await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true)",[school]);await assert.rejects(client.query(sql),/permission denied/);await client.query('ROLLBACK');
    }
    await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true)",[school]);await assert.rejects(client.query('INSERT INTO attendance_roster_snapshots(id,school_id,register_id,learner_id,enrolment_id,full_name,admission_number) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),school,view.id,learner,interval,'Unreviewed insert','DUP']),/draft register/);await client.query('ROLLBACK');
    await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true)",[school]);await assert.rejects(client.query("UPDATE attendance_registers SET roster_source='legacy_marks' WHERE school_id=$1 AND id=$2",[school,view.id]),/provenance is immutable/);await client.query('ROLLBACK');
  }finally{await client.query('ROLLBACK');client.release();}
});

test('concurrent corrections commit exactly one version and one correction',async()=>{
  const view=await read();const responses=await Promise.all(['late','absent'].map(mark=>call(`/attendance/classes/${section}/register`,{day:today,version:view.version,action:'correct',marks:[{learnerId:learner,mark}],correctionReason:'Reviewed concurrent evidence'})));
  assert.deepEqual(responses.map(response=>response.status).sort(),[201,409]);const saved=await read();assert.equal(saved.version,view.version+1);assert.equal(['late','absent'].includes(saved.items[0].mark),true);assert.equal((await owner.query('SELECT count(*) FROM attendance_corrections WHERE register_id=$1',[view.id])).rows[0].count,'1');
});

test('audit failure rolls back finalized mark, correction, register version and receipt',async()=>{
  const view=await read(),op=randomUUID();const counts=(await owner.query('SELECT (SELECT count(*) FROM attendance_corrections WHERE register_id=$1) AS corrections,(SELECT count(*) FROM audit_events WHERE target_id=$1) AS events',[view.id])).rows[0];
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT attendance_integrity_audit_failure CHECK(action<>'attendance.register.correct') NOT VALID");
  try{await post(`/attendance/classes/${section}/register`,{operationId:op,day:today,version:view.version,action:'correct',marks:[{learnerId:learner,mark:'excused'}],correctionReason:'Rollback after mark and correction writes'},500);}
  finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT attendance_integrity_audit_failure');}
  assert.deepEqual(await read(),view);assert.deepEqual((await owner.query('SELECT (SELECT count(*) FROM attendance_corrections WHERE register_id=$1) AS corrections,(SELECT count(*) FROM audit_events WHERE target_id=$1) AS events',[view.id])).rows[0],counts);assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,op])).rows[0].count,'0');
});

test('failed submission rolls back roster capture and draft mark edits; the same operation can retry',async()=>{
  const date=day(1);await post('/attendance/school-days',{day:date,isOpen:true,reason:'Reviewed submission rollback day'});const draft=await post(`/attendance/classes/${section}/register`,{day:date,version:0,action:'save',marks:[{learnerId:learner,mark:'unmarked'}]});
  const payload={operationId:randomUUID(),day:date,version:draft.version,action:'submit',marks:[{learnerId:learner,mark:'present'}]};await owner.query("ALTER TABLE audit_events ADD CONSTRAINT attendance_submit_audit_failure CHECK(action<>'attendance.register.submit') NOT VALID");
  try{await post(`/attendance/classes/${section}/register`,payload,500);}finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT attendance_submit_audit_failure');}
  const unchanged=await read(section,date);assert.equal(unchanged.status,'draft');assert.equal(unchanged.version,draft.version);assert.equal(unchanged.rosterSource,null);assert.equal(unchanged.items[0].mark,'unmarked');assert.equal((await owner.query('SELECT count(*) FROM attendance_roster_snapshots WHERE register_id=$1',[draft.id])).rows[0].count,'0');assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,payload.operationId])).rows[0].count,'0');
  const submitted=await post(`/attendance/classes/${section}/register`,payload);assert.deepEqual(await post(`/attendance/classes/${section}/register`,payload),submitted);assert.equal((await read(section,date)).items[0].mark,'present');assert.equal((await owner.query('SELECT count(*) FROM attendance_roster_snapshots WHERE register_id=$1',[draft.id])).rows[0].count,'1');
});

async function waitForTransactionBlock(pid:number){
  for(let attempt=0;attempt<100;attempt++){
    if((await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='school_app' AND $1=ANY(pg_blocking_pids(pid))",[pid])).rowCount)return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }assert.fail('Expected the API command to wait on the earlier transaction');
}
test('submission and withdrawal serialize both orderings into one coherent roster',async()=>{
  const date=day(4);await post('/attendance/school-days',{day:date,isOpen:true,reason:'Reviewed concurrency test day'});
  for(const first of ['submit','withdraw']){
    const classId=randomUUID(),child=randomUUID();await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,'Primary',20)",[classId,school,year,`${first} first class`]);await owner.query('INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)',[child,school,`RACE-${child.slice(0,8)}`,`${first} first learner`]);await owner.query('INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,$5)',[randomUUID(),school,child,classId,day(-1)]);
    const marks=[{learnerId:child,mark:'present'}],draft=await post(`/attendance/classes/${classId}/register`,{day:date,version:0,action:'save',marks});const submit={operationId:randomUUID(),day:date,version:draft.version,action:'submit',marks},withdraw={operationId:randomUUID(),effectiveDate:day(3),version:1,reason:'Reviewed departure before register date'};
    const client=await runtime.connect();let pending:Promise<Response>|undefined;
    try{
      await client.query('BEGIN');await client.query("SELECT set_config('app.school_id',$1,true),set_config('app.user_id',$2,true)",[school,user]);const pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      if(first==='submit'){await new AttendanceService().save(client,actor,classId,submit);pending=call(`/learners/${child}/withdraw`,withdraw);}
      else{await new LearnersService().withdraw(client,actor,child,withdraw);pending=call(`/attendance/classes/${classId}/register`,submit);}
      await waitForTransactionBlock(pid);await client.query('COMMIT');const response=await pending;assert.equal(response.status,first==='submit'?201:400,JSON.stringify(await response.json()));
      const final=await read(classId,date);assert.equal(final.status,first==='submit'?'submitted':'draft');assert.equal(final.items.length,first==='submit'?1:0);assert.equal((await owner.query('SELECT count(*) FROM attendance_roster_snapshots WHERE register_id=$1',[draft.id])).rows[0].count,first==='submit'?'1':'0');
    }finally{await client.query('ROLLBACK');client.release();if(pending)await pending;}
  }
});
