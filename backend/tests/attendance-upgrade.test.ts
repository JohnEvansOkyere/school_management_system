import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const {AttendanceService}=require('../dist/modules/attendance/attendance.service');
const owner=new Pool({host:path.resolve(__dirname,'../../.local/postgres/socket'),port:55438,database:process.env.LOCAL_DB_NAME??'school_saas_local',user:process.env.USER});
after(()=>owner.end());

test('forward upgrade restores legacy marks, labels ambiguity and preserves empty finalized registers',async()=>{
  const client=await owner.connect();const schema=`attendance_upgrade_${randomUUID().replaceAll('-','')}`;
  try{
    await client.query('BEGIN');await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET LOCAL search_path=${schema},public`);
    // Clone the relevant 012/014 shapes in a transaction. No public rows change.
    for(const table of ['academic_years','class_sections','learners','enrolments','school_days','attendance_registers','attendance_marks','attendance_roster_snapshots','attendance_corrections','command_receipts','audit_events'])await client.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
    await client.query('ALTER TABLE attendance_registers DROP COLUMN roster_source');
    const school=randomUUID(),section=randomUUID(),year=randomUUID(),member=randomUUID(),learner=randomUUID(),staleLearner=randomUUID(),enrolment=randomUUID(),staleEnrolment=randomUUID();
    const actor={schoolId:school,membershipId:member,userId:randomUUID(),role:'headteacher'};
    await client.query("INSERT INTO academic_years(id,school_id,name,start_date,end_date) VALUES($1,$2,'Legacy year','2026-01-01','2027-01-01')",[year,school]);
    await client.query("INSERT INTO class_sections(id,school_id,academic_year_id,name,level,capacity) VALUES($1,$2,$3,'Legacy class','Primary',20)",[section,school,year]);
    await client.query("INSERT INTO learners(id,school_id,full_name,admission_number) VALUES($1,$2,'Current legacy name','LEGACY-1'),($3,$2,'Obsolete draft member','LEGACY-2')",[learner,school,staleLearner]);
    await client.query("INSERT INTO enrolments(id,school_id,learner_id,class_id,start_date,end_date,end_reason) VALUES($1,$2,$3,$4,'2026-01-01','2026-02-01','Historical withdrawal'),($5,$2,$6,$4,'2026-01-01','2026-02-01','Old draft member left')",[enrolment,school,learner,section,staleEnrolment,staleLearner]);
    const regular=randomUUID(),empty=randomUUID(),ambiguous=randomUUID(),captured=randomUUID();
    for(const [id,day] of [[regular,'2026-03-01'],[empty,'2026-03-02'],[ambiguous,'2026-03-03'],[captured,'2026-03-04']]){
      await client.query("INSERT INTO school_days(id,school_id,day,is_open,reason,created_by) VALUES($1,$2,$3,true,'Legacy reviewed day',$4)",[randomUUID(),school,day,member]);
      await client.query("INSERT INTO attendance_registers(id,school_id,class_id,day,status,created_by,submitted_at,submitted_by) VALUES($1,$2,$3,$4,'submitted',$5,now(),$5)",[id,school,section,day,member]);
    }
    for(const [id,who,interval] of [[regular,learner,enrolment],[ambiguous,learner,enrolment],[ambiguous,staleLearner,staleEnrolment],[captured,learner,enrolment]])await client.query("INSERT INTO attendance_marks(id,school_id,register_id,learner_id,enrolment_id,mark) VALUES($1,$2,$3,$4,$5,'present')",[randomUUID(),school,id,who,interval]);
    await client.query("INSERT INTO attendance_roster_snapshots(id,school_id,register_id,learner_id,enrolment_id,full_name,admission_number) VALUES($1,$2,$3,$4,$5,'Name captured in 014','ORIGINAL-NUMBER')",[randomUUID(),school,captured,learner,enrolment]);
    await client.query(readFileSync(path.resolve(__dirname,'../migrations/015_attendance_snapshot_integrity.sql'),'utf8'));
    const service=new AttendanceService();
    for(const [id,day,count,source] of [[regular,'2026-03-01',1,'legacy_marks'],[empty,'2026-03-02',0,'legacy_marks'],[ambiguous,'2026-03-03',2,'legacy_marks'],[captured,'2026-03-04',1,'submission']] as const){
      const view=await service.register(client,actor,section,{day});assert.equal(view.id,id);assert.equal(view.rosterSource,source);assert.equal(view.items.length,count);
      if(id===captured){assert.equal(view.items[0].full_name,'Name captured in 014');assert.equal(view.items[0].admission_number,'ORIGINAL-NUMBER');}
      const marks=view.items.map((row:any)=>({learnerId:row.id,mark:row.mark}));
      const locked=await service.save(client,actor,section,{operationId:randomUUID(),day,version:view.version,action:'lock',marks});assert.equal(locked.status,'locked');
      const correction={operationId:randomUUID(),day,version:locked.version,action:'correct',marks:marks.map((row:any)=>({...row,mark:'late'})),correctionReason:'Reviewed saved legacy attendance'};
      const saved=await service.save(client,actor,section,correction);assert.deepEqual(await service.save(client,actor,section,correction),saved);
      const final=await service.register(client,actor,section,{day});assert.equal(final.items.length,count);assert.equal(final.rosterSource,source);assert.equal(final.items.every((row:any)=>row.mark==='late'),true);
    }
  }finally{await client.query('ROLLBACK');client.release();}
});
