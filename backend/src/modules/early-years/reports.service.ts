import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { createHash,randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { EarlyYearsReportCreateDto,EarlyYearsReportEditDto,EarlyYearsReportListDto,EarlyYearsReportRevisionDto,EarlyYearsReportTransitionDto } from './reports.dto';

const templateVersion='early-years-narrative-v1';
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const normalized=(value:string)=>value.trim();

@Injectable()
export class EarlyYearsReportsService {
  private actorName(actor:Actor){
    if(!actor.displayName)throw new NotFoundException('Staff identity unavailable');
    return actor.displayName;
  }

  private async snapshot(client:PoolClient,actor:Actor,learnerId:string,enrolmentId:string,periodStart:string,periodEnd:string,preservedSnapshot?:any){
    if(periodStart>periodEnd)throw new BadRequestException('Report period end must not precede its start');
    const dates=(await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS today,($1::date-$2::date) AS days",[periodEnd,periodStart])).rows[0];
    if(periodEnd>dates.today)throw new BadRequestException('Reports cannot include future dates');
    if(Number(dates.days)>366)throw new BadRequestException('Report periods cannot exceed one school year');
    const learner=(await client.query('SELECT id,full_name,admission_number FROM learners WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,learnerId])).rows[0];
    if(!learner)throw new NotFoundException('Learner unavailable');
    const enrolmentRef=(await client.query('SELECT class_id FROM enrolments WHERE school_id=$1 AND id=$2 AND learner_id=$3',[actor.schoolId,enrolmentId,learnerId])).rows[0];
    if(!enrolmentRef)throw new NotFoundException('Enrolment unavailable');
    const section=(await client.query('SELECT id FROM class_sections WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,enrolmentRef.class_id])).rows[0];
    if(!section)throw new NotFoundException('Historical class unavailable');
    const enrolment=(await client.query(`SELECT e.id,e.learner_id,e.class_id,e.start_date::text,e.end_date::text,e.superseded_at::text,c.level,c.name AS class_name,y.name AS year_name,y.start_date::text AS year_start,y.end_date::text AS year_end
      FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id
      WHERE e.school_id=$1 AND e.id=$2 AND e.learner_id=$3 FOR SHARE OF e,c`,[actor.schoolId,enrolmentId,learnerId])).rows[0];
    if(!enrolment)throw new NotFoundException('Historical class unavailable');
    if(!preservedSnapshot&&(!['Nursery','KG'].includes(enrolment.level)||enrolment.superseded_at||periodStart<enrolment.start_date||periodEnd>= (enrolment.end_date??'9999-12-31')||periodStart<enrolment.year_start||periodEnd>=enrolment.year_end))throw new BadRequestException('The entire report period must fit this Nursery or KG enrolment and academic year');
    const placement=preservedSnapshot?.placement??{enrolmentId:enrolment.id,classId:enrolment.class_id,className:enrolment.class_name,level:enrolment.level,academicYear:enrolment.year_name,startDate:enrolment.start_date,endDate:enrolment.end_date};
    if(actor.role==='teacher'){
      const grant=(await client.query(`SELECT id FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND teacher_membership_id=$3 AND revoked_at IS NULL AND start_date<=$4 AND end_date>$5 AND start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND end_date>(now() AT TIME ZONE 'Africa/Accra')::date FOR SHARE`,[actor.schoolId,enrolment.class_id,actor.membershipId,periodStart,periodEnd])).rowCount;
      if(!grant)throw new NotFoundException('Report unavailable for this class or period');
    }else if(actor.role!=='headteacher')throw new ForbiddenException('Only assigned teachers and headteachers can prepare reports');

    const observations=(await client.query(`SELECT o.id,o.observed_on::text,o.level,o.educator_membership_id,o.educator_display_name,o.recorded_by_membership_id,o.policy_id,o.policy_version,o.policy_snapshot,o.entries,o.version,o.created_at
      FROM early_years_observations o WHERE o.school_id=$1 AND o.learner_id=$2 AND o.class_id=$3 AND o.enrolment_id=$4 AND o.observed_on BETWEEN $5 AND $6
      AND NOT EXISTS(SELECT 1 FROM early_years_observations newer WHERE newer.school_id=o.school_id AND newer.supersedes_id=o.id)
      ORDER BY o.observed_on,o.created_at,o.id`,[actor.schoolId,learnerId,enrolment.class_id,enrolmentId,periodStart,periodEnd])).rows;
    const pending=(await client.query("SELECT id,status,day::text FROM attendance_registers WHERE school_id=$1 AND class_id=$2 AND day BETWEEN $3 AND $4 AND status<>'locked' ORDER BY day,id FOR SHARE",[actor.schoolId,enrolment.class_id,periodStart,periodEnd])).rows;
    if(pending.length)throw new ConflictException('Finalize attendance registers in this period before submitting a report');
    const attendance=(await client.query(`SELECT r.id,r.day::text,r.version,r.status,r.roster_source,s.learner_id IS NOT NULL AS included,s.full_name AS learner_name,s.admission_number,
      m.mark,m.version AS mark_version
      FROM attendance_registers r LEFT JOIN attendance_roster_snapshots s ON s.school_id=r.school_id AND s.register_id=r.id AND s.learner_id=$3
      LEFT JOIN attendance_marks m ON m.school_id=r.school_id AND m.register_id=r.id AND m.learner_id=$3
      WHERE r.school_id=$1 AND r.class_id=$2 AND r.day BETWEEN $4 AND $5 AND r.status='locked' ORDER BY r.day,r.id`,[actor.schoolId,enrolment.class_id,learnerId,periodStart,periodEnd])).rows;
    const corrections=attendance.length?(await client.query(`SELECT c.register_id,c.old_mark,c.new_mark,c.reason,c.reviewer_membership_id,c.created_at
      FROM attendance_corrections c WHERE c.school_id=$1 AND c.learner_id=$2 AND c.register_id=ANY($3::uuid[]) ORDER BY c.created_at,c.id`,[actor.schoolId,learnerId,attendance.map((row:any)=>row.id)])).rows:[];
    const correctionMap=new Map<string,any[]>();for(const row of corrections){const items=correctionMap.get(row.register_id)??[];items.push(row);correctionMap.set(row.register_id,items);}
    const attendanceItems=attendance.map((row:any)=>({registerId:row.id,day:row.day,registerVersion:row.version,status:row.status,rosterSource:row.roster_source,learnerIncluded:row.included,learnerName:row.learner_name??null,admissionNumber:row.admission_number??null,mark:row.mark??null,markVersion:row.mark_version??null,corrections:correctionMap.get(row.id)??[]}));
    const counts={present:0,late:0,absent:0,excused:0,unmarked:0,missingRoster:0};
    for(const item of attendanceItems){if(!item.learnerIncluded)counts.missingRoster++;else if(!item.mark||item.mark==='unmarked')counts.unmarked++;else counts[item.mark as keyof typeof counts]++;}
    return {templateVersion,learner:preservedSnapshot?.learner??{id:learner.id,fullName:learner.full_name,admissionNumber:learner.admission_number},placement,period:{start:periodStart,end:periodEnd},observations,attendance:{registers:attendanceItems,counts,coverageNote:'Counts include finalized class registers available in this period. No attendance percentage is calculated; registers without a captured learner roster and unmarked entries remain explicit.'}};
  }

  private inputDigest(snapshot:unknown,content:{strengths:string;nextSteps:string;teacherNote?:string|null}){
    return digest({templateVersion,snapshot,strengths:content.strengths,nextSteps:content.nextSteps,teacherNote:content.teacherNote??null});
  }

  private async event(client:PoolClient,actor:Actor,reportId:string,revisionId:string,action:string,inputDigest:string,reason?:string){
    const displayName=this.actorName(actor);
    await client.query('INSERT INTO early_years_report_events(id,school_id,report_id,revision_id,actor_membership_id,actor_display_name,action,reason,input_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),actor.schoolId,reportId,revisionId,actor.membershipId,displayName,action,reason??null,inputDigest]);
    return displayName;
  }

  private async invalidateApproval(client:PoolClient,actor:Actor,revision:any,id:string,reason:string){
    const updated=(await client.query("UPDATE early_years_report_revisions SET status='returned',returned_by=$1,returned_at=now(),return_reason=$2,version=version+1 WHERE school_id=$3 AND id=$4 RETURNING version,status",[actor.membershipId,reason,actor.schoolId,id])).rows[0];
    await this.event(client,actor,revision.report_id,id,'returned',revision.input_digest,reason);
    await audit(client,actor,'early-years.report.returned',id,{reportId:revision.report_id,version:updated.version,reason,invalidatedApproval:true});
    return {id,reportId:revision.report_id,...updated,invalidatedApproval:true};
  }

  create(client:PoolClient,actor:Actor,body:EarlyYearsReportCreateDto){return command(client,actor,body.operationId,'early-years.report.create',body,async()=>{
    const snapshot=await this.snapshot(client,actor,body.learnerId,body.enrolmentId,body.periodStart,body.periodEnd);
    const reportId=randomUUID(),revisionId=randomUUID(),strengths=normalized(body.strengths),nextSteps=normalized(body.nextSteps),teacherNote=body.teacherNote?normalized(body.teacherNote):null;
    const author=this.actorName(actor),inputDigest=this.inputDigest(snapshot,{strengths,nextSteps,teacherNote});
    await client.query('INSERT INTO early_years_reports(id,school_id,learner_id,enrolment_id,class_id,level,period_start,period_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[reportId,actor.schoolId,body.learnerId,body.enrolmentId,snapshot.placement.classId,snapshot.placement.level,body.periodStart,body.periodEnd]);
    await client.query('INSERT INTO early_years_report_revisions(id,school_id,report_id,revision,author_membership_id,author_display_name,strengths,next_steps,teacher_note,snapshot,input_digest,template_version) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11)',[revisionId,actor.schoolId,reportId,actor.membershipId,author,strengths,nextSteps,teacherNote,JSON.stringify(snapshot),inputDigest,templateVersion]);
    await client.query('UPDATE early_years_reports SET current_revision_id=$1 WHERE school_id=$2 AND id=$3',[revisionId,actor.schoolId,reportId]);
    await this.event(client,actor,reportId,revisionId,'drafted',inputDigest);await audit(client,actor,'early-years.report.drafted',reportId,{revisionId,level:snapshot.placement.level,periodStart:body.periodStart,periodEnd:body.periodEnd});
    return {id:reportId,revisionId,revision:1,version:1,status:'draft',learnerId:body.learnerId};
  });}

  save(client:PoolClient,actor:Actor,id:string,body:EarlyYearsReportEditDto){return command(client,actor,body.operationId,'early-years.report.save',{id,...body},async()=>{
    const revision=(await client.query(`SELECT v.*,r.current_revision_id,r.learner_id,r.enrolment_id,r.period_start::text,r.period_end::text FROM early_years_report_revisions v JOIN early_years_reports r ON r.school_id=v.school_id AND r.id=v.report_id WHERE v.school_id=$1 AND v.id=$2 FOR UPDATE OF v,r`,[actor.schoolId,id])).rows[0];
    if(!revision)throw new NotFoundException('Report revision unavailable');
    if(revision.current_revision_id!==id||revision.status!=='draft')throw new ConflictException('Only the current draft revision can be edited');
    if(revision.version!==body.version)throw new ConflictException('Report draft changed. Reload before saving');
    if(actor.role==='teacher'&&revision.author_membership_id!==actor.membershipId)throw new NotFoundException('Report draft unavailable');
    const snapshot=await this.snapshot(client,actor,revision.learner_id,revision.enrolment_id,revision.period_start,revision.period_end,revision.snapshot);
    const strengths=normalized(body.strengths),nextSteps=normalized(body.nextSteps),teacherNote=body.teacherNote?normalized(body.teacherNote):null,inputDigest=this.inputDigest(snapshot,{strengths,nextSteps,teacherNote});
    const updated=(await client.query('UPDATE early_years_report_revisions SET strengths=$1,next_steps=$2,teacher_note=$3,snapshot=$4,input_digest=$5,version=version+1 WHERE school_id=$6 AND id=$7 RETURNING version,status',[strengths,nextSteps,teacherNote,JSON.stringify(snapshot),inputDigest,actor.schoolId,id])).rows[0];
    await this.event(client,actor,revision.report_id,id,'draft_updated',inputDigest);await audit(client,actor,'early-years.report.draft-updated',id,{reportId:revision.report_id,version:updated.version});return {id,reportId:revision.report_id,...updated};
  });}

  revise(client:PoolClient,actor:Actor,reportId:string,body:EarlyYearsReportRevisionDto){return command(client,actor,body.operationId,'early-years.report.revise',{reportId,...body},async()=>{
    const report=(await client.query('SELECT * FROM early_years_reports WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,reportId])).rows[0];if(!report)throw new NotFoundException('Report unavailable');
    const prior=(await client.query('SELECT * FROM early_years_report_revisions WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,report.current_revision_id])).rows[0];
    if(!prior||prior.version!==body.version)throw new ConflictException('Report changed. Reload before creating a revision');
    if(!['returned','published'].includes(prior.status))throw new ConflictException('Only a returned or published report can start a new revision');
    if(actor.role==='teacher'&&prior.author_membership_id!==actor.membershipId)throw new NotFoundException('Report unavailable');
    const snapshot=await this.snapshot(client,actor,report.learner_id,report.enrolment_id,report.period_start.toISOString().slice(0,10),report.period_end.toISOString().slice(0,10),prior.snapshot);
    const id=randomUUID(),revision=prior.revision+1,strengths=normalized(body.strengths),nextSteps=normalized(body.nextSteps),teacherNote=body.teacherNote?normalized(body.teacherNote):null,correctionReason=normalized(body.correctionReason),displayName=this.actorName(actor),inputDigest=this.inputDigest(snapshot,{strengths,nextSteps,teacherNote});
    await client.query('INSERT INTO early_years_report_revisions(id,school_id,report_id,revision,supersedes_id,correction_reason,author_membership_id,author_display_name,strengths,next_steps,teacher_note,snapshot,input_digest,template_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,actor.schoolId,reportId,revision,prior.id,correctionReason,actor.membershipId,displayName,strengths,nextSteps,teacherNote,JSON.stringify(snapshot),inputDigest,templateVersion]);
    await client.query('UPDATE early_years_reports SET current_revision_id=$1 WHERE school_id=$2 AND id=$3',[id,actor.schoolId,reportId]);
    await this.event(client,actor,reportId,id,'corrected',inputDigest,correctionReason);await audit(client,actor,'early-years.report.revised',id,{reportId,supersedesId:prior.id,revision,reason:correctionReason});return {id,reportId,revision,version:1,status:'draft',supersedesId:prior.id};
  });}

  private async transition(client:PoolClient,actor:Actor,id:string,body:EarlyYearsReportTransitionDto,action:'submit'|'return'|'approve'|'publish'){
    return command(client,actor,body.operationId,`early-years.report.${action}`,{id,...body},async()=>{
      const revision=(await client.query(`SELECT v.*,r.current_revision_id,r.learner_id,r.enrolment_id,r.period_start::text,r.period_end::text FROM early_years_report_revisions v JOIN early_years_reports r ON r.school_id=v.school_id AND r.id=v.report_id WHERE v.school_id=$1 AND v.id=$2 FOR UPDATE OF r,v`,[actor.schoolId,id])).rows[0];
      if(!revision||revision.current_revision_id!==id)throw new NotFoundException('Current report revision unavailable');
      if(revision.version!==body.version)throw new ConflictException('Report changed. Reload before reviewing');
      if(action==='return'||action==='approve'||action==='publish'){if(actor.role!=='headteacher')throw new ForbiddenException('Only headteachers can review and publish reports');}
      else if(actor.role==='teacher'&&revision.author_membership_id!==actor.membershipId)throw new NotFoundException('Report unavailable');
      const expected=action==='submit'?'draft':action==='return'?(revision.status==='approved'?'approved':'submitted'):action==='approve'?'submitted':'approved';
      if(revision.status!==expected)throw new ConflictException(`Only ${expected} reports can be ${({submit:'submitted',return:'returned',approve:'approved',publish:'published'} as const)[action]}`);
      if(action==='return'){
        if(!body.reason)throw new BadRequestException('A return reason is required');
        const returned=(await client.query("UPDATE early_years_report_revisions SET status='returned',returned_by=$1,returned_at=now(),return_reason=$2,version=version+1 WHERE school_id=$3 AND id=$4 RETURNING version,status",[actor.membershipId,body.reason.trim(),actor.schoolId,id])).rows[0];
        await this.event(client,actor,revision.report_id,id,'returned',revision.input_digest,body.reason.trim());
        await audit(client,actor,'early-years.report.returned',id,{reportId:revision.report_id,version:returned.version,reason:body.reason.trim()});
        return {id,reportId:revision.report_id,...returned};
      }
      let snapshot:any;
      try { snapshot=await this.snapshot(client,actor,revision.learner_id,revision.enrolment_id,revision.period_start,revision.period_end,revision.snapshot); }
      catch(error){if(action==='publish'&&error instanceof ConflictException)return this.invalidateApproval(client,actor,revision,id,'Attendance evidence changed after approval; review a new report revision.');throw error;}
      const inputDigest=this.inputDigest(snapshot,{strengths:revision.strengths,nextSteps:revision.next_steps,teacherNote:revision.teacher_note});
      if(['submit','approve'].includes(action)&&inputDigest!==revision.input_digest)throw new ConflictException('Report evidence or narrative changed. Refresh the draft before continuing');
      if(action==='publish'&&inputDigest!==revision.input_digest){
        return this.invalidateApproval(client,actor,revision,id,'Evidence changed after approval; review a new report revision.');
      }
      let updated:any;
      if(action==='submit')updated=(await client.query("UPDATE early_years_report_revisions SET status='submitted',submitted_by=$1,submitted_at=now(),version=version+1 WHERE school_id=$2 AND id=$3 RETURNING version,status",[actor.membershipId,actor.schoolId,id])).rows[0];
      if(action==='approve')updated=(await client.query("UPDATE early_years_report_revisions SET status='approved',approved_by=$1,approved_at=now(),version=version+1 WHERE school_id=$2 AND id=$3 RETURNING version,status",[actor.membershipId,actor.schoolId,id])).rows[0];
      if(action==='publish')updated=(await client.query("UPDATE early_years_report_revisions SET status='published',published_by=$1,published_at=now(),version=version+1 WHERE school_id=$2 AND id=$3 RETURNING version,status",[actor.membershipId,actor.schoolId,id])).rows[0];
      await this.event(client,actor,revision.report_id,id,action==='submit'?'submitted':action==='approve'?'approved':'published',inputDigest);
      await audit(client,actor,`early-years.report.${action==='submit'?'submitted':action==='approve'?'approved':'published'}`,id,{reportId:revision.report_id,version:updated.version});return {id,reportId:revision.report_id,...updated};
    });
  }
  submit(client:PoolClient,actor:Actor,id:string,body:EarlyYearsReportTransitionDto){return this.transition(client,actor,id,body,'submit');}
  returnForChanges(client:PoolClient,actor:Actor,id:string,body:EarlyYearsReportTransitionDto){return this.transition(client,actor,id,body,'return');}
  approve(client:PoolClient,actor:Actor,id:string,body:EarlyYearsReportTransitionDto){return this.transition(client,actor,id,body,'approve');}
  publish(client:PoolClient,actor:Actor,id:string,body:EarlyYearsReportTransitionDto){return this.transition(client,actor,id,body,'publish');}

  async list(client:PoolClient,actor:Actor,page:EarlyYearsReportListDto){
    if(page.status&&!['draft','submitted','returned','approved','published'].includes(page.status))throw new BadRequestException('Select a valid report status');
    const params:any[]=[actor.schoolId];let where='r.school_id=$1';
    if(page.classId){params.push(page.classId);where+=` AND r.class_id=$${params.length}`;}
    if(page.learnerId){params.push(page.learnerId);where+=` AND r.learner_id=$${params.length}`;}
    if(page.status){params.push(page.status);where+=` AND v.status=$${params.length}`;}
    if(actor.role==='teacher'){
      const grants=(await client.query("SELECT id FROM teaching_assignments WHERE school_id=$1 AND teacher_membership_id=$2 AND revoked_at IS NULL AND start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND end_date>(now() AT TIME ZONE 'Africa/Accra')::date FOR SHARE",[actor.schoolId,actor.membershipId])).rows.map(row=>row.id);
      params.push(grants);const grantParam=params.length;
      where+=` AND EXISTS(SELECT 1 FROM teaching_assignments t WHERE t.school_id=r.school_id AND t.class_id=r.class_id AND t.id=ANY($${grantParam}::uuid[]) AND t.start_date<=r.period_start AND t.end_date>r.period_end)`;
    }else if(actor.role!=='headteacher')throw new ForbiddenException('Only teachers and headteachers can access staff reports');
    const from='FROM early_years_reports r JOIN early_years_report_revisions v ON v.school_id=r.school_id AND v.id=r.current_revision_id';
    const total=Number((await client.query(`SELECT count(*) ${from} WHERE ${where}`,params)).rows[0].count);
    const items=(await client.query(`SELECT r.id AS report_id,r.learner_id,r.class_id,r.enrolment_id,r.level,r.period_start::text,r.period_end::text,v.*,v.author_membership_id=$${params.length+1} AS can_edit ${from} WHERE ${where} ORDER BY r.period_start DESC,r.learner_id,r.id LIMIT $${params.length+2} OFFSET $${params.length+3}`,[...params,actor.membershipId,page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit};
  }

  async guardianReports(client:PoolClient,actor:Actor,learnerId:string){
    const link=(await client.query('SELECT id FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rows[0];
    if(!link)throw new NotFoundException('Child unavailable');
    const revisions=(await client.query(`SELECT r.id AS report_id,r.level,r.period_start::text,r.period_end::text,v.id AS revision_id,v.revision,v.status,v.strengths,v.next_steps,v.teacher_note,v.snapshot,v.template_version,v.approved_at,v.published_at,v.author_display_name
      FROM early_years_reports r JOIN early_years_report_revisions v ON v.school_id=r.school_id AND v.report_id=r.id
      WHERE r.school_id=$1 AND r.learner_id=$2 AND v.status='published' ORDER BY r.period_start DESC,v.revision DESC,v.published_at DESC`,[actor.schoolId,learnerId])).rows;
    const items=revisions.map(({snapshot,...row}:any)=>({
      ...row,
      snapshot:{
        learner:{fullName:snapshot.learner.fullName},
        placement:{className:snapshot.placement.className,level:snapshot.placement.level,academicYear:snapshot.placement.academicYear},
        observations:snapshot.observations.map((item:any)=>({observedOn:item.observed_on,educator:item.educator_display_name,entries:item.entries.map((entry:any)=>({title:entry.title,learningArea:entry.learningArea,strand:entry.strand,subStrand:entry.subStrand,status:entry.status,descriptor:entry.descriptor?.text??null,evidence:entry.evidence}))})),
        attendance:{counts:snapshot.attendance.counts,coverageNote:snapshot.attendance.coverageNote,registers:snapshot.attendance.registers.map((item:any)=>({day:item.day,mark:item.mark,learnerIncluded:item.learnerIncluded}))}
      }
    }));
    return {items};
  }
}
