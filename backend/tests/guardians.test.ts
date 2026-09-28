import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const config={host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:'school_saas_local'};
const owner=new Pool({...config,user:process.env.USER}),runtime=new Pool({...config,user:'school_app'});
const school=randomUUID(),other=randomUUID(),learner=randomUUID(),second=randomUUID(),outside=randomUUID(),year=randomUUID(),section=randomUUID();
const users=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004'];
const members=users.map(()=>randomUUID()),otherGuardian=randomUUID();
let app:any,base:string,head:any,guardian:any,teacher:any,desk:any;
async function login(email:string){const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'Synthetic-only-2026!'})});assert.equal(response.status,201);return {cookie:response.headers.get('set-cookie')!.split(';')[0],csrf:(await response.json()).csrfToken};}
function call(route:string,method='GET',body?:unknown,actor=head,target=school){return fetch(`${base}/schools/${target}${route}`,{method,headers:{cookie:actor.cookie,'content-type':'application/json','x-csrf-token':actor.csrf},...(body?{body:JSON.stringify(body)}:{})});}
async function post(route:string,body:Record<string,unknown>,status=201,actor=head,target=school){const response=await call(route,'POST',{operationId:randomUUID(),...body},actor,target);const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
const rights={academic:true,billing:false,pickup:false,contact:false};
async function link(id=learner,grant=rights){return post('/guardian-links',{learnerId:id,guardianMembershipId:members[2],...grant});}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  [head,guardian,teacher,desk]=await Promise.all(['head@example.test','guardian@example.test','teacher@example.test','frontdesk@example.test'].map(login));
  await owner.query('INSERT INTO schools(id,name) VALUES($1,$2),($3,$4)',[school,'Guardian test school',other,'Other guardian school']);
  for(let i=0;i<4;i++)await owner.query('INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,$4)',[members[i],school,users[i],['headteacher','teacher','guardian','frontdesk'][i]]);
  await owner.query("INSERT INTO memberships(id,school_id,user_id,role) VALUES($1,$2,$3,'guardian'),($4,$2,$5,'headteacher')",[otherGuardian,other,users[2],randomUUID(),users[0]]);
  for(const [id,tenant,name] of [[learner,school,'Academic synthetic child'],[second,school,'Billing synthetic child'],[outside,other,'Other synthetic child']])await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name,date_of_birth) VALUES($1,$2,$3,$4,'2018-05-03')",[id,tenant,`G-${id.slice(0,8)}`,name]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Guardian year','2026-09-01','2027-08-01')",[year,school]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Guardian class','Primary',20)",[section,school,year]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date) VALUES($1,$2,$3,$4,'2026-09-01')",[randomUUID(),school,learner,section]);
  await owner.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date,superseded_at,supersession_reason) VALUES($1,$2,$3,$4,'2026-10-01',now(),'Superseded synthetic reservation')",[randomUUID(),school,learner,section]);
});
after(async()=>{await app?.close();await owner.end();await runtime.end();});
test('guardian schema fails closed and candidate projection checks tenant and head role',async()=>{
  assert.equal((await runtime.query('SELECT * FROM guardian_links')).rowCount,0);
  assert.equal((await runtime.query("SELECT relforcerowsecurity FROM pg_class WHERE relname='guardian_links'")).rows[0].relforcerowsecurity,true);
  const candidates=await (await call('/guardian-candidates')).json();assert.deepEqual(candidates,[{id:members[2],display_name:'Abena Sample'}]);
  const client=await runtime.connect();try{
    await client.query('BEGIN');await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.school_id',$2,true)",[users[1],school]);
    assert.equal((await client.query('SELECT * FROM guardian_candidates($1)',[school])).rowCount,0);
    assert.equal((await client.query('SELECT lock_guardian_membership($1,$2) AS allowed',[school,members[2]])).rows[0].allowed,false);
    await client.query("SELECT set_config('app.user_id',$1,true)",[users[0]]);assert.equal((await client.query('SELECT * FROM guardian_candidates($1)',[other])).rowCount,0);
  }finally{await client.query('ROLLBACK');client.release();}
});
test('guardian link commands deny unrelated roles, cross-school references and empty rights',async()=>{
  const body={learnerId:learner,guardianMembershipId:members[2],...rights};
  for(const actor of [guardian,teacher,desk]){await post('/guardian-links',body,403,actor);assert.equal((await call('/guardian-candidates','GET',undefined,actor)).status,403);}
  await post('/guardian-links',{...body,learnerId:outside},404);await post('/guardian-links',{...body,guardianMembershipId:otherGuardian},404);
  await post('/guardian-links',{...body,guardianMembershipId:members[1]},404);
  await post('/guardian-links',{...body,academic:false},400);
  await assert.rejects(owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,academic,billing,pickup,contact,guardian_display_name) VALUES($1,$2,$3,$4,true,false,false,false,'Synthetic guardian')",[randomUUID(),other,learner,otherGuardian]),/foreign key/);
  await assert.rejects(owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,academic,billing,pickup,contact,guardian_display_name,verified_at,verified_by) VALUES($1,$2,$3,$4,true,false,false,false,'Synthetic guardian',now(),$5)",[randomUUID(),school,learner,members[2],members[0]]),/guardian_verified_reason_required/);
  await assert.rejects(owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,academic,billing,pickup,contact,guardian_display_name,revoked_at,revoked_by) VALUES($1,$2,$3,$4,true,false,false,false,'Synthetic guardian',now(),$5)",[randomUUID(),school,learner,members[2],members[0]]),/guardian_revoked_reason_required/);
});
let academicLink:any,billingLink:any;
test('pending links grant nothing; verified academic and billing projections are distinct',async()=>{
  const body={operationId:randomUUID(),learnerId:learner,guardianMembershipId:members[2],...rights};
  academicLink=await post('/guardian-links',body);assert.equal((await post('/guardian-links',body)).id,academicLink.id);
  assert.deepEqual(await (await call('/guardian/children','GET',undefined,guardian)).json(),[]);
  assert.equal((await call(`/guardian/children/${learner}`,'GET',undefined,guardian)).status,404);
  await post(`/guardian-links/${academicLink.id}/verify`,{version:1},400);
  academicLink=await post(`/guardian-links/${academicLink.id}/verify`,{version:1,reason:'Synthetic rights reviewed with school records'});
  billingLink=await link(second,{academic:false,billing:true,pickup:false,contact:false});billingLink=await post(`/guardian-links/${billingLink.id}/verify`,{version:1,reason:'Synthetic sponsor billing authorization only'});
  const children=await (await call('/guardian/children','GET',undefined,guardian)).json();assert.equal(children.length,2);assert.ok(children.every(child=>!('date_of_birth' in child)&&!('enrolments' in child)));
  const academic=await (await call(`/guardian/children/${learner}`,'GET',undefined,guardian)).json();assert.equal(academic.date_of_birth,'2018-05-03');assert.equal(academic.enrolments.length,1);assert.equal(academic.enrolments[0].class_name,'Guardian class');assert.ok(!('verified_by' in academic));
  const billing=await (await call(`/guardian/children/${second}`,'GET',undefined,guardian)).json();assert.equal(billing.billing,true);assert.equal(billing.pickup,false);assert.ok(!('enrolments' in billing)&&!('date_of_birth' in billing));
  assert.equal((await call(`/guardian/children/${outside}`,'GET',undefined,guardian)).status,404);
  assert.equal((await call(`/guardian/children/${learner}`,'GET',undefined,guardian,other)).status,404);
});
test('revocation takes effect on the existing guardian session and replacement does not inherit rights',async()=>{
  const body={operationId:randomUUID(),version:academicLink.version,reason:'Reviewed synthetic guardian rights revoked'};
  const revoked=await post(`/guardian-links/${academicLink.id}/revoke`,body);assert.equal((await post(`/guardian-links/${academicLink.id}/revoke`,body)).id,revoked.id);
  assert.equal((await call(`/guardian/children/${learner}`,'GET',undefined,guardian)).status,404);
  assert.equal((await (await call('/guardian/children','GET',undefined,guardian)).json()).length,1);
  const replacement=await link(learner,{academic:false,billing:false,pickup:true,contact:true});await post(`/guardian-links/${replacement.id}/verify`,{version:1,reason:'Reviewed pickup and contact without academic authority'});
  const child=await (await call(`/guardian/children/${learner}`,'GET',undefined,guardian)).json();assert.equal(child.academic,false);assert.equal(child.pickup,true);assert.ok(!('enrolments' in child));
  await assert.rejects(owner.query('UPDATE guardian_links SET revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL WHERE id=$1',[revoked.id]),/immutable/);
  await assert.rejects(owner.query('UPDATE guardian_links SET academic=false WHERE id=$1',[academicLink.id]),/immutable/);
});
test('membership revocation and role changes deny previously verified rights immediately',async()=>{
  try{await owner.query('UPDATE memberships SET revoked_at=now() WHERE id=$1',[members[2]]);assert.equal((await call('/guardian/children','GET',undefined,guardian)).status,404);const history=await (await call('/guardian-links?search=Academic%20synthetic%20child')).json();assert.ok(history.items.every(row=>row.guardian_name==='Abena Sample'));
    await owner.query("UPDATE memberships SET revoked_at=NULL,role='teacher' WHERE id=$1",[members[2]]);assert.equal((await call('/guardian/children','GET',undefined,guardian)).status,403);
  }finally{await owner.query("UPDATE memberships SET revoked_at=NULL,role='guardian' WHERE id=$1",[members[2]]);}
});
test('versioned verify/revoke race commits once and failed audit restores pending link',async()=>{
  const id=randomUUID();await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,'Race synthetic child')",[id,school,`R-${id.slice(0,8)}`]);const pending=await link(id);
  const replies=await Promise.all(['verify','revoke'].map(action=>call(`/guardian-links/${pending.id}/${action}`,'POST',{operationId:randomUUID(),version:1,reason:'Concurrent reviewed action'})));assert.deepEqual(replies.map(row=>row.status).sort(),[201,409]);
  const id2=randomUUID();await owner.query("INSERT INTO learners(id,school_id,admission_number,full_name) VALUES($1,$2,$3,'Rollback synthetic child')",[id2,school,`R-${id2.slice(0,8)}`]);const rollback=await link(id2),body={operationId:randomUUID(),version:1,reason:'Reviewed rollback verification'};
  await owner.query("ALTER TABLE audit_events ADD CONSTRAINT synthetic_guardian_failure CHECK(action<>'guardian.link.verified') NOT VALID");
  try{await post(`/guardian-links/${rollback.id}/verify`,body,500);const row=(await owner.query('SELECT version,verified_at FROM guardian_links WHERE id=$1',[rollback.id])).rows[0];assert.deepEqual(row,{version:1,verified_at:null});assert.equal((await owner.query('SELECT count(*) FROM command_receipts WHERE school_id=$1 AND id=$2',[school,body.operationId])).rows[0].count,'0');}
  finally{await owner.query('ALTER TABLE audit_events DROP CONSTRAINT synthetic_guardian_failure');}
  await post(`/guardian-links/${rollback.id}/verify`,body);
});
test('paged link history includes old active grants and literal search with tenant-safe totals',async()=>{
  await owner.query("INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,academic,billing,pickup,contact,guardian_display_name,revoked_at,revoked_by,revocation_reason) SELECT gen_random_uuid(),$1,$2,$3,true,false,false,false,'Synthetic guardian',now(),$4,'Synthetic prior revoked grant' FROM generate_series(1,501)",[school,second,members[2],members[0]]);
  const a=await (await call('/guardian-links?limit=2')).json(),b=await (await call('/guardian-links?limit=2&offset=2')).json();assert.ok(a.total>=5);assert.equal(a.items.length,2);assert.equal(b.items.length,2);assert.equal(new Set([...a.items,...b.items].map(row=>row.id)).size,4);
  const search=await (await call('/guardian-links?search=Academic%20synthetic%20child')).json();assert.equal(search.total,2);assert.ok(search.items.some(row=>row.id===academicLink.id));
  const literal=await (await call('/guardian-links?search=%25')).json();assert.equal(literal.total,0);assert.equal((await call('/guardian-links?limit=501')).status,400);
  const oldest=await (await call(`/guardian-links?limit=5&offset=${a.total-5}`)).json();assert.ok(oldest.items.some(row=>row.id===academicLink.id));
});
