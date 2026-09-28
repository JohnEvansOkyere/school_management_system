import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { AttendancePageDto,RegisterDto,SchoolDayDto } from './attendance.dto';
const escaped=(term?:string)=>`%${(term??'').trim().replace(/[\\%_]/g,'\\$&')}%`;
@Injectable()
export class AttendanceService {
  async setDay(client:PoolClient,actor:Actor,body:SchoolDayDto){return command(client,actor,body.operationId,'attendance.school-day',body,async()=>{
    const year=(await client.query("SELECT 1 FROM academic_years WHERE school_id=$1 AND start_date<=$2 AND end_date>$2",[actor.schoolId,body.day])).rowCount;
    if(!year)throw new BadRequestException('School day must be inside an academic year');
    const current=(await client.query('SELECT * FROM school_days WHERE school_id=$1 AND day=$2 FOR UPDATE',[actor.schoolId,body.day])).rows[0];
    if(current&&body.version!==current.version)throw new ConflictException('School day changed. Reload before saving');
    const row=current?(await client.query('UPDATE school_days SET is_open=$1,reason=$2,version=version+1 WHERE school_id=$3 AND day=$4 RETURNING id,day,is_open,reason,version',[body.isOpen,body.reason,actor.schoolId,body.day])).rows[0]:(await client.query('INSERT INTO school_days(id,school_id,day,is_open,reason,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,day,is_open,reason,version',[randomUUID(),actor.schoolId,body.day,body.isOpen,body.reason,actor.membershipId])).rows[0];
    await audit(client,actor,body.isOpen?'attendance.school-day.opened':'attendance.school-day.closed',row.id,{day:body.day,reason:body.reason,version:row.version});return row;
  });}
  async days(client:PoolClient,actor:Actor,page:AttendancePageDto){const result=await client.query('SELECT id,day::text,is_open,reason,version FROM school_days WHERE school_id=$1 AND day BETWEEN $2 AND $3 ORDER BY day',[actor.schoolId,page.day,page.day]);return result.rows;}
  private async authorized(client:PoolClient,actor:Actor,classId:string,day:string){
    const section=(await client.query('SELECT c.id,c.name,y.start_date::text,y.end_date::text FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 AND c.id=$2 FOR SHARE OF c',[actor.schoolId,classId])).rows[0];
    if(!section||day<section.start_date||day>=section.end_date)throw new NotFoundException('Attendance register unavailable');
    const schoolDay=(await client.query('SELECT * FROM school_days WHERE school_id=$1 AND day=$2 AND is_open=true FOR SHARE',[actor.schoolId,day])).rows[0];
    if(!schoolDay)throw new ConflictException('This school day is not open');
    if(actor.role==='teacher'){
      const assignment=await client.query("SELECT id FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND teacher_membership_id=$3 AND revoked_at IS NULL AND start_date<=$4 AND end_date>$4 AND start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND end_date>(now() AT TIME ZONE 'Africa/Accra')::date FOR SHARE",[actor.schoolId,classId,actor.membershipId,day]);
      if(!assignment.rowCount)throw new NotFoundException('Attendance register unavailable');
    }else if(actor.role!=='headteacher')throw new ForbiddenException('Only assigned teachers and headteachers can access attendance');
    return section;
  }
  async register(client:PoolClient,actor:Actor,classId:string,page:AttendancePageDto){
    const section=await this.authorized(client,actor,classId,page.day);const existing=(await client.query('SELECT id,status,version FROM attendance_registers WHERE school_id=$1 AND class_id=$2 AND day=$3',[actor.schoolId,classId,page.day])).rows[0];
    const eligible=(await client.query('SELECT l.id,l.full_name,l.admission_number,e.id AS enrolment_id FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id WHERE e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<=$3 AND (e.end_date IS NULL OR e.end_date>$3) ORDER BY l.full_name,l.id',[actor.schoolId,classId,page.day])).rows;
    const marks=existing?(await client.query('SELECT learner_id,mark FROM attendance_marks WHERE school_id=$1 AND register_id=$2',[actor.schoolId,existing.id])).rows:[];const byLearner=new Map(marks.map(row=>[row.learner_id,row.mark]));
    return {id:existing?.id??null,status:existing?.status??'draft',version:existing?.version??0,className:section.name,date:page.day,items:eligible.map(row=>({...row,mark:byLearner.get(row.id)??'unmarked'}))};
  }
  async save(client:PoolClient,actor:Actor,classId:string,body:RegisterDto){return command(client,actor,body.operationId,`attendance.register.${body.action}`,{classId,...body},async()=>{
    const section=await this.authorized(client,actor,classId,body.day);const current=(await client.query('SELECT * FROM attendance_registers WHERE school_id=$1 AND class_id=$2 AND day=$3 FOR UPDATE',[actor.schoolId,classId,body.day])).rows[0];
    if(body.action==='lock'&&actor.role!=='headteacher')throw new ForbiddenException('Only the headteacher can lock a register');
    if(!current&&body.version!==0)throw new ConflictException('Register changed. Reload before saving');if(current&&current.version!==body.version)throw new ConflictException('Register changed. Reload before saving');
    if(current?.status==='locked'&&body.action!=='correct')throw new ConflictException('Locked registers require a correction');if(current?.status==='locked'&&actor.role!=='headteacher')throw new ForbiddenException('Only the headteacher can correct a locked register');if(body.action==='correct'&&!body.correctionReason)throw new BadRequestException('Corrections require a reason');if(body.action==='submit'&&current?.status!=='draft')throw new ConflictException('Only draft registers can be submitted');if(body.action==='lock'&&current?.status!=='submitted')throw new ConflictException('Only submitted registers can be locked');
    const eligible=(await client.query('SELECT l.id,e.id AS enrolment_id FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id WHERE e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<=$3 AND (e.end_date IS NULL OR e.end_date>$3)',[actor.schoolId,classId,body.day])).rows;const allowed=new Map(eligible.map(row=>[row.id,row.enrolment_id]));
    if(new Set(body.marks.map(row=>row.learnerId)).size!==body.marks.length||body.marks.some(row=>!allowed.has(row.learnerId)))throw new BadRequestException('Marks must contain each eligible learner at most once');
    if(body.marks.length!==eligible.length)throw new BadRequestException('Submit the complete eligible roster, including unmarked learners');
    const register=current??(await client.query('INSERT INTO attendance_registers(id,school_id,class_id,day,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),actor.schoolId,classId,body.day,actor.membershipId])).rows[0];
    const oldMarks=new Map((await client.query('SELECT learner_id,mark FROM attendance_marks WHERE school_id=$1 AND register_id=$2',[actor.schoolId,register.id])).rows.map(row=>[row.learner_id,row.mark]));
    for(const row of body.marks){const old=oldMarks.get(row.learnerId);if(old&&old!==row.mark){if(body.action!=='correct')throw new ConflictException('Existing marks require a correction action');await client.query('INSERT INTO attendance_corrections(id,school_id,register_id,learner_id,old_mark,new_mark,reason,reviewer_membership_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),actor.schoolId,register.id,row.learnerId,old,row.mark,body.correctionReason,actor.membershipId]);await audit(client,actor,'attendance.mark.corrected',register.id,{learnerId:row.learnerId,oldMark:old,newMark:row.mark,reason:body.correctionReason});await client.query('UPDATE attendance_marks SET mark=$1,version=version+1 WHERE school_id=$2 AND register_id=$3 AND learner_id=$4',[row.mark,actor.schoolId,register.id,row.learnerId]);}else if(!old)await client.query('INSERT INTO attendance_marks(id,school_id,register_id,learner_id,enrolment_id,mark) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.schoolId,register.id,row.learnerId,allowed.get(row.learnerId),row.mark]);}
    const next=body.action==='submit'?'submitted':body.action==='lock'?'locked':register.status;const updated=(await client.query(`UPDATE attendance_registers SET status=$1,version=version+1,submitted_at=CASE WHEN $1='submitted' THEN COALESCE(submitted_at,now()) ELSE submitted_at END,submitted_by=CASE WHEN $1='submitted' THEN COALESCE(submitted_by,$2) ELSE submitted_by END,locked_at=CASE WHEN $1='locked' THEN now() ELSE locked_at END,locked_by=CASE WHEN $1='locked' THEN $2 ELSE locked_by END WHERE school_id=$3 AND id=$4 RETURNING id,status,version`,[next,actor.membershipId,actor.schoolId,register.id])).rows[0];
    await audit(client,actor,`attendance.register.${body.action}`,register.id,{classId,day:body.day,version:updated.version});return updated;
  });}
}
