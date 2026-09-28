import { BadRequestException,ConflictException,Injectable,NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { PageDto } from '../learners/learners.dto';
import { RevokeTeachingDto,RosterQueryDto,TeachingAssignmentDto } from './teaching.dto';
const literal=(term?:string)=>`%${(term??'').trim().replace(/[\\%_]/g,'\\$&')}%`;
const scope="school_id=$1 AND teacher_membership_id=$2 AND revoked_at IS NULL AND start_date<=$3::date AND end_date>$3::date AND start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND end_date>(now() AT TIME ZONE 'Africa/Accra')::date";
@Injectable()
export class TeachingService {
  async classes(client:PoolClient,actor:Actor,page:PageDto,date?:string) {
    let eligible:string[]|undefined;
    if(date)eligible=(await client.query(`SELECT class_id FROM teaching_assignments WHERE ${scope} FOR SHARE`,[actor.schoolId,actor.membershipId,date])).rows.map(row=>row.class_id);
    const filter="c.school_id=$1 AND (c.name ILIKE $2 ESCAPE '\\' OR y.name ILIKE $2 ESCAPE '\\' OR c.level ILIKE $2 ESCAPE '\\') AND ($3::uuid[] IS NULL OR c.id=ANY($3::uuid[]))";
    const from='FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id';
    const values=[actor.schoolId,literal(page.search),eligible??null];
    const total=Number((await client.query(`SELECT count(*) ${from} WHERE ${filter}`,values)).rows[0].count);
    const items=(await client.query(`SELECT c.id,c.name,c.level,y.name AS year_name,y.start_date::text,y.end_date::text ${from} WHERE ${filter} ORDER BY y.start_date DESC,c.name,c.id LIMIT $4 OFFSET $5`,[...values,page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit};
  }
  async assignments(client:PoolClient,actor:Actor,page:PageDto) {
    const from='FROM teaching_assignments t JOIN class_sections c ON c.school_id=t.school_id AND c.id=t.class_id';
    const filter="t.school_id=$1 AND (c.name ILIKE $2 ESCAPE '\\' OR t.teacher_display_name ILIKE $2 ESCAPE '\\')";
    const total=Number((await client.query(`SELECT count(*) ${from} WHERE ${filter}`,[actor.schoolId,literal(page.search)])).rows[0].count);
    const items=(await client.query(`SELECT t.id,t.class_id,c.name AS class_name,t.teacher_display_name,t.start_date::text,t.end_date::text,t.grant_reason,t.revoked_at,t.revocation_reason,t.version ${from} WHERE ${filter} ORDER BY t.created_at DESC,t.id LIMIT $3 OFFSET $4`,[actor.schoolId,literal(page.search),page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit};
  }
  create(client:PoolClient,actor:Actor,body:TeachingAssignmentDto) {
    return command(client,actor,body.operationId,'teaching.assignment.create',body,async()=>{
      const section=(await client.query('SELECT y.start_date::text,y.end_date::text FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2',[actor.schoolId,body.classId])).rows[0];
      const teacher=(await client.query('SELECT * FROM teacher_candidates($1,$2)',[actor.schoolId,body.teacherMembershipId])).rows[0];
      if(!section||!teacher)throw new NotFoundException('Class or teacher unavailable');
      if(body.startDate>=body.endDate||body.startDate<section.start_date||body.endDate>section.end_date)throw new BadRequestException('Assignment dates must be inside the class academic year, with end after start');
      try{
        const record=(await client.query('INSERT INTO teaching_assignments(id,school_id,class_id,teacher_membership_id,teacher_display_name,start_date,end_date,grant_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version',[randomUUID(),actor.schoolId,body.classId,body.teacherMembershipId,teacher.display_name,body.startDate,body.endDate,body.reason,actor.membershipId])).rows[0];
        await audit(client,actor,'teaching.assignment.created',record.id,{classId:body.classId,reason:body.reason,startDate:body.startDate,endDate:body.endDate});return record;
      }catch(error){if((error as {code?:string}).code==='23P01')throw new ConflictException('This teacher already has an overlapping assignment for this class');throw error;}
    });
  }
  revoke(client:PoolClient,actor:Actor,id:string,body:RevokeTeachingDto) {
    return command(client,actor,body.operationId,'teaching.assignment.revoke',{id,...body},async()=>{
      const record=(await client.query('SELECT * FROM teaching_assignments WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,id])).rows[0];
      if(!record)throw new NotFoundException('Assignment unavailable');
      if(record.revoked_at||record.version!==body.version)throw new ConflictException('Assignment changed. Reload before revoking');
      await client.query('UPDATE teaching_assignments SET revoked_at=now(),revoked_by=$1,revocation_reason=$2,version=version+1 WHERE school_id=$3 AND id=$4',[actor.membershipId,body.reason,actor.schoolId,id]);
      await audit(client,actor,'teaching.assignment.revoked',id,{reason:body.reason,version:record.version+1});return {id,version:record.version+1};
    });
  }
  async roster(client:PoolClient,actor:Actor,classId:string,page:RosterQueryDto) {
    if(actor.role==='teacher') {
      const allowed=await client.query(`SELECT id FROM teaching_assignments WHERE ${scope} AND class_id=$4 FOR SHARE`,[actor.schoolId,actor.membershipId,page.date,classId]);
      if(!allowed.rowCount)throw new NotFoundException('Class roster unavailable');
    }
    const section=(await client.query('SELECT c.name,y.start_date::text,y.end_date::text FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 FOR SHARE OF c',[actor.schoolId,classId])).rows[0];
    if(!section)throw new NotFoundException('Class roster unavailable');
    if(page.date<section.start_date||page.date>=section.end_date)throw new BadRequestException('Roster date must be inside the class academic year');
    const from='FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id';
    const filter="e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<=$3::date AND (e.end_date IS NULL OR e.end_date>$3::date) AND (l.full_name ILIKE $4 ESCAPE '\\' OR l.admission_number ILIKE $4 ESCAPE '\\')";
    const params=[actor.schoolId,classId,page.date,literal(page.search)];
    const total=Number((await client.query(`SELECT count(*) ${from} WHERE ${filter}`,params)).rows[0].count);
    const items=(await client.query(`SELECT l.id,l.full_name,l.admission_number,e.id AS enrolment_id ${from} WHERE ${filter} ORDER BY l.full_name,l.id LIMIT $5 OFFSET $6`,[...params,page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit,className:section.name,date:page.date};
  }
}
