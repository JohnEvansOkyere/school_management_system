import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const {createApp}=require('../dist/main');
const schoolA='10000000-0000-4000-8000-000000000001';
const memberA='30000000-0000-4000-8000-000000000001';
const owner=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
let app:any,base:string,cookie:string;
const yearId=randomUUID(),otherYearId=randomUUID();
async function get(url:string) {
  const response=await fetch(`${base}/schools/${schoolA}${url}`,{headers:{cookie}});
  return {status:response.status,body:await response.json()};
}
async function walk(url:string) {
  const items:any[]=[];let total=-1;
  for(let offset=0;;offset+=100){
    const page=await get(`${url}${url.includes('?')?'&':'?'}limit=100&offset=${offset}`);
    assert.equal(page.status,200);total=page.body.total;items.push(...page.body.items);
    if(page.body.items.length<100)break;
  }
  return {items,total};
}
before(async()=>{
  process.env.DEV_AUTH='synthetic-local';app=await createApp();await app.listen(0,'127.0.0.1');base=`${await app.getUrl()}/api/v1`;
  const response=await fetch(`${base}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'head@example.test',password:'Synthetic-only-2026!'})});
  cookie=response.headers.get('set-cookie')!.split(';')[0];
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$3,'Paging year A','2030-01-01','2031-01-01'),($2,$3,'Paging year B','2031-01-01','2032-01-01')",[yearId,otherYearId,schoolA]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) SELECT gen_random_uuid(),$1,$2,'Paging class '||lpad(n::text,3,'0'),'Primary',30 FROM generate_series(1,150) n",[schoolA,yearId]);
  await owner.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES(gen_random_uuid(),$1,$2,'Paging other year class','Primary',30)",[schoolA,otherYearId]);
  await owner.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) SELECT gen_random_uuid(),$1,'Paging bulk year '||lpad(n::text,3,'0'),date '2040-01-01'+n*2,date '2040-01-02'+n*2 FROM generate_series(1,130) n",[schoolA]);
  await owner.query("INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id,metadata,created_at) SELECT gen_random_uuid(),$1,$2,'paging.synthetic',$1,jsonb_build_object('n',n),now()+n*interval '1 second' FROM generate_series(1,2000) n",[schoolA,memberA]);
});
after(async()=>{await app?.close();await owner.end();});

test('classes are paged and filtered by academic year: 150 classes, none silently dropped',async()=>{
  const all=await walk(`/classes?academicYearId=${yearId}`);
  assert.equal(all.total,150);assert.equal(all.items.length,150);assert.equal(new Set(all.items.map(row=>row.id)).size,150);
  assert.ok(all.items.every(row=>row.academic_year_id===yearId));
  assert.deepEqual(all.items.map(row=>row.name),[...all.items.map(row=>row.name)].sort());
  const first=await get(`/classes?academicYearId=${yearId}&limit=10&offset=0`),second=await get(`/classes?academicYearId=${yearId}&limit=10&offset=10`);
  assert.equal(first.body.items.length,10);assert.equal(first.body.limit,10);assert.equal(second.body.offset,10);
  assert.equal(new Set([...first.body.items,...second.body.items].map(row=>row.id)).size,20);
  const unfiltered=await get('/classes?limit=1');assert.ok(unfiltered.body.total>=151);
  assert.equal((await get(`/classes?academicYearId=${randomUUID()}`)).body.total,0);
  assert.equal((await get('/classes?academicYearId=not-a-uuid')).status,400);assert.equal((await get('/classes?limit=1000')).status,400);
});

test('academic years are paged and newest first',async()=>{
  const all=await walk('/academic-years');
  assert.ok(all.total>=132);assert.equal(all.items.length,all.total);assert.equal(new Set(all.items.map(row=>row.id)).size,all.total);
  const dates=all.items.map(row=>row.start_date);assert.deepEqual(dates,[...dates].sort().reverse());
  assert.equal((await get('/academic-years?limit=101')).status,400);
});

test('audit view is paged: 2,000 events are all reachable, newest first, without duplicates',async()=>{
  const expected=Number((await owner.query('SELECT count(*) FROM audit_events WHERE school_id=$1',[schoolA])).rows[0].count);
  assert.ok(expected>=2000);
  const all=await walk('/audit');
  assert.equal(all.total,expected);assert.equal(all.items.length,expected);assert.equal(new Set(all.items.map(row=>row.id)).size,expected);
  const times=all.items.map(row=>new Date(row.created_at).getTime());assert.deepEqual(times,[...times].sort((a,b)=>b-a));
  const firstPage=await get('/audit');assert.equal(firstPage.body.items.length,25);assert.equal(firstPage.body.limit,25);
});
