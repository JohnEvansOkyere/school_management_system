import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');const {NoticeSender}=require('../dist/jobs/notice-sender');const {normalizeGhanaPhone,FallbackSms}=require('../dist/modules/notices/sms.provider');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER});
const school=randomUUID(),year=randomUUID(),classA=randomUUID(),classB=randomUUID(),headM=randomUUID(),teacherM=randomUUID();
const g=[randomUUID(),randomUUID(),randomUUID()],gUser=['20000000-0000-4000-8000-000000000003',randomUUID(),randomUUID()],gPhone=['+233241111111',null,'+233242222222'];
let app:any,base:string,head:any,teacher:any;const senders:any[]=[];
async function login(email:string){const r=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],csrf:(await r.json()).csrfToken};}
async function call(route:string,method='GET',body?:unknown,actor=head){const r=await fetch(`${base}/schools/${school}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json().catch(()=>null)};}
async function ok(route:string,body:Record<string,unknown>,status=201){const r=await call(route,'POST',{operationId:randomUUID(),...body});assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
function sender(fail:string[]=[],enabled=true){const sent:string[]=[];const fake=enabled?{name:'fake',async send(to:string){if(fail.includes(to))throw new Error('provider down');sent.push(to);return {provider:'fake',providerMessageId:`m-${sent.length}`};}}:null;const s=new NoticeSender(fake);senders.push(s);return {s,sent};}
async function states(notice:string){return Object.fromEntries((await owner.query('SELECT to_phone,state FROM notice_deliveries WHERE notice_id=$1',[notice])).rows.map(r=>[r.to_phone??'none',r.state]));}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,teacher]=await Promise.all(['head@example.test','teacher@example.test'].map(login));
  await owner.query("INSERT INTO schools(id,name) VALUES($1,'Notice school')",[school]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$3,'20000000-0000-4000-8000-000000000001','headteacher'),($2,$3,'20000000-0000-4000-8000-000000000002','teacher')",[headM,teacherM,school]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Notice year',current_date-60,current_date+120)",[year,school]);
  for(const [id,name] of [[classA,'Class A'],[classB,'Class B']])await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,$4,'Primary',30)",[id,school,year,name]);
  for(let i=0;i<3;i++){
    if(i===0)await owner.query("UPDATE users SET phone=$2 WHERE id=$1",[gUser[i],gPhone[i]]);
    else await owner.query("INSERT INTO users(id,display_name,synthetic_login,password_hash,phone) VALUES($1,$2,$3,'x',$4)",[gUser[i],`Guardian ${i}`,`notice-g${i}-${gUser[i]}@example.test`,gPhone[i]]);
    await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'guardian')",[g[i],school,gUser[i]]);
    const learner=randomUUID();
    await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,$4)",[learner,school,`NO-${learner.slice(0,8)}`,`Notice Learner ${i}`]);
    await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,current_date-30)",[randomUUID(),school,learner,i===1?classB:classA]);
    await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,guardian_display_name,academic,billing,pickup,contact,verified_at,verified_by,verification_reason) VALUES($1,$2,$3,$4,$5,true,false,false,$6,now(),$7,'Checked in person')",[randomUUID(),school,learner,g[i],`Guardian ${i}`,i!==2,headM]);
  }
});
after(async()=>{for(const s of senders)await s.close();await app?.close();await owner.end();});

test('phone numbers normalise to Ghana format and fallback tries the next provider',async()=>{
  assert.equal(normalizeGhanaPhone('024 123 4567'),'+233241234567');assert.equal(normalizeGhanaPhone('233241234567'),'+233241234567');assert.equal(normalizeGhanaPhone('+233-24-123-4567'),'+233241234567');
  for(const bad of ['12345','0241234','+44 7700 900123','024123456789'])assert.equal(normalizeGhanaPhone(bad),null);
  const calls:string[]=[];const f=new FallbackSms([{name:'a',async send(){calls.push('a');throw new Error('down');}},{name:'b',async send(){calls.push('b');return {provider:'b',providerMessageId:'1'};}}]);
  assert.equal((await f.send('+233241234567','hi','r')).provider,'b');assert.deepEqual(calls,['a','b']);
  await assert.rejects(new FallbackSms([]).send('+233241234567','hi','r'),/No SMS provider/);
});

test('only the headteacher manages notices',async()=>{
  assert.equal((await call('/notices','GET',undefined,teacher)).status,403);
  assert.equal((await call('/notices','POST',{operationId:randomUUID(),title:'Hello',body:'Body text',audience:'school'},teacher)).status,403);
  assert.equal((await call('/guardian/notices','GET',undefined,head)).status,403);
});

test('validation: class audience needs a class of this school; length limits',async()=>{
  const bad=(extra:Record<string,unknown>)=>call('/notices','POST',{operationId:randomUUID(),title:'Valid title',body:'Valid body',audience:'school',...extra});
  assert.equal((await bad({audience:'class'})).status,400);assert.equal((await bad({audience:'class',classId:randomUUID()})).status,404);
  assert.equal((await bad({body:'x'.repeat(321)})).status,400);assert.equal((await bad({title:'  '})).status,400);
});

let schoolNotice='',classNotice='';
test('approval freezes recipients: contact right only, phones queued, others in-app only',async()=>{
  const op=randomUUID(),body={operationId:op,title:'Term dates',body:'School reopens on Monday.',audience:'school'};
  const created=await call('/notices','POST',body);assert.equal(created.status,201);assert.deepEqual((await call('/notices','POST',body)).body,created.body);
  schoolNotice=created.body.id;
  assert.equal((await owner.query('SELECT count(*) FROM notice_deliveries WHERE notice_id=$1',[schoolNotice])).rows[0].count,'0');
  assert.equal((await call(`/notices/${schoolNotice}/approve`,'POST',{operationId:randomUUID(),version:99})).status,409);
  const approved=await ok(`/notices/${schoolNotice}/approve`,{version:1});assert.equal(approved.recipients,2);assert.equal(approved.withPhone,1);
  assert.deepEqual(await states(schoolNotice),{'+233241111111':'queued',none:'in_app_only'});
  assert.equal((await call(`/notices/${schoolNotice}/approve`,'POST',{operationId:randomUUID(),version:2})).status,409);
  assert.equal((await owner.query('SELECT count(*) FROM notice_deliveries WHERE notice_id=$1 AND guardian_membership_id=$2',[schoolNotice,g[2]])).rows[0].count,'0');
  assert.equal((await owner.query('SELECT count(*) FROM notice_deliveries WHERE notice_id=$1',[schoolNotice])).rows[0].count,'2');
  assert.equal((await owner.query("SELECT count(*) FROM audit_events WHERE target_id=$1 AND action IN ('notice.created','notice.approved')",[schoolNotice])).rows[0].count,'2');
});

test('class notices reach only guardians of that class',async()=>{
  const created=await ok('/notices',{title:'Class A trip',body:'Bring a packed lunch.',audience:'class',classId:classA});classNotice=created.id;
  const approved=await ok(`/notices/${classNotice}/approve`,{version:1});assert.equal(approved.recipients,1);assert.deepEqual(await states(classNotice),{'+233241111111':'queued'});
  const list=(await call('/notices')).body.items;assert.equal(list.find((n:any)=>n.id===classNotice).class_name,'Class A');assert.deepEqual(list.find((n:any)=>n.id===schoolNotice).deliveries,{queued:1,in_app_only:1});
});

test('a notice with no eligible guardian cannot be approved',async()=>{
  const created=await ok('/notices',{title:'Empty class',body:'Nobody here.',audience:'class',classId:classB});
  await owner.query("UPDATE guardian_links SET revoked_at=now(),revoked_by=$2,revocation_reason='test' WHERE guardian_membership_id=$1",[g[1],headM]);
  assert.equal((await call(`/notices/${created.id}/approve`,'POST',{operationId:randomUUID(),version:1})).status,400);
});

test('with SMS switched off nothing leaves the system',async()=>{
  const {s,sent}=sender([],false);await s.runOnce();assert.deepEqual(sent,[]);
  assert.equal((await states(schoolNotice))['+233241111111'],'suppressed');assert.equal((await states(classNotice))['+233241111111'],'suppressed');
});

test('sender sends once, records failure, and never resends automatically; head can requeue failed',async()=>{
  const a=await ok('/notices',{title:'Fees reminder',body:'Fees are due Friday.',audience:'class',classId:classA});await ok(`/notices/${a.id}/approve`,{version:1});
  const down=sender(['+233241111111']);await down.s.runOnce();assert.deepEqual(down.sent,[]);assert.equal((await states(a.id))['+233241111111'],'failed');
  await down.s.runOnce();assert.deepEqual(down.sent,[]);
  const detail=(await call(`/notices/${a.id}/deliveries`)).body.items[0];assert.equal(detail.state,'failed');assert.equal(detail.phone,'••••••111');assert.match(detail.last_error,/provider down/);assert.equal(detail.guardian,'Guardian 0');
  assert.equal((await ok(`/notices/${a.id}/retry-failed`,{})).requeued,1);
  const up=sender();await up.s.runOnce();await up.s.runOnce();assert.deepEqual(up.sent,['+233241111111']);
  const row=(await owner.query("SELECT state,provider,provider_message_id,attempts FROM notice_deliveries WHERE notice_id=$1",[a.id])).rows[0];assert.deepEqual([row.state,row.provider,row.attempts],['sent','fake',2]);
});

test('interrupted sends are flagged for a person, never resent',async()=>{
  const n=await ok('/notices',{title:'Sports day',body:'Sports day is on Thursday.',audience:'class',classId:classA});await ok(`/notices/${n.id}/approve`,{version:1});
  await owner.query("UPDATE notice_deliveries SET state='sending',updated_at=now()-interval '10 minutes' WHERE notice_id=$1",[n.id]);
  const s=sender();await s.s.runOnce();assert.deepEqual(s.sent,[]);assert.equal((await states(n.id))['+233241111111'],'failed');
});

test('cancelling stops unsent messages and needs a reason',async()=>{
  const n=await ok('/notices',{title:'Cancel me',body:'This will be cancelled.',audience:'school'});await ok(`/notices/${n.id}/approve`,{version:1});
  assert.equal((await call(`/notices/${n.id}/cancel`,'POST',{operationId:randomUUID(),reason:''})).status,400);
  assert.equal((await ok(`/notices/${n.id}/cancel`,{reason:'Sent to wrong audience'})).unsentStopped,1);
  const s=sender();await s.s.runOnce();assert.deepEqual(s.sent,[]);assert.equal((await states(n.id))['+233241111111'],'cancelled');
  assert.equal((await call(`/notices/${n.id}/cancel`,'POST',{operationId:randomUUID(),reason:'Again please'})).status,409);
});

test('guardians read only notices delivered to them',async()=>{
  const guardian=await login('guardian@example.test');
  const own=(await call('/guardian/notices','GET',undefined,guardian)).body.items;
  assert.deepEqual(own.map((n:any)=>n.title).sort(),['Class A trip','Fees reminder','Sports day','Term dates'].sort());
  assert.equal(own.some((n:any)=>n.title==='Cancel me'),false,'cancelled notices are hidden');
  assert.equal((await call('/notices','GET',undefined,guardian)).status,403);assert.equal((await call(`/notices/${schoolNotice}/deliveries`,'GET',undefined,guardian)).status,403);
  await owner.query("UPDATE memberships SET revoked_at=now() WHERE id=$1",[g[0]]);
  assert.equal((await call('/guardian/notices','GET',undefined,guardian)).status,404,'a revoked guardian loses access');
});

test('staff phone numbers are normalised, audited and shown to the headteacher',async()=>{
  const user='20000000-0000-4000-8000-000000000002';
  assert.equal((await call(`/accounts/${user}/phone`,'POST',{phone:'not a number'})).status,400);
  const r=await call(`/accounts/${user}/phone`,'POST',{phone:'024 555 0100'});assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.phone,'+233245550100');
  assert.equal((await call('/accounts')).body.items.find((a:any)=>a.user_id===user).phone,'+233245550100');
  assert.equal((await call(`/accounts/${user}/phone`,'POST',{phone:''})).body.phone,null);
  assert.equal((await call(`/accounts/${user}/phone`,'POST',{phone:'0245550100'},teacher)).status,403);
});
