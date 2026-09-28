import { BadRequestException,ConflictException,Injectable,NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { PageDto } from './learners.dto';
import { CollectionCaseDto,CollectionReleaseDto,CollectionReviewDto,CollectionRosterDto,CollectionVoidDto } from './collection.dto';
const literal=(term?:string)=>`%${(term??'').trim().replace(/[\\%_]/g,'\\$&')}%`;
@Injectable()
export class CollectionService {
  async today(client:PoolClient){return (await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS date")).rows[0].date as string;}
  async roster(client:PoolClient,actor:Actor,page:CollectionRosterDto){
    const date=await this.today(client),from='FROM learners l LEFT JOIN enrolments e ON e.school_id=l.school_id AND e.learner_id=l.id AND e.superseded_at IS NULL AND e.start_date<=$2::date AND (e.end_date IS NULL OR e.end_date>$2::date) AND EXISTS(SELECT 1 FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=e.school_id AND c.id=e.class_id AND y.start_date<=$2::date AND y.end_date>$2::date) LEFT JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id';
    const filter="l.school_id=$1 AND (e.id IS NOT NULL OR ($4::boolean AND (EXISTS(SELECT 1 FROM collection_events h WHERE h.school_id=l.school_id AND h.learner_id=l.id) OR EXISTS(SELECT 1 FROM collection_cases h WHERE h.school_id=l.school_id AND h.learner_id=l.id)))) AND (l.full_name ILIKE $3 ESCAPE '\\' OR l.admission_number ILIKE $3 ESCAPE '\\')";
    const values=[actor.schoolId,date,literal(page.search),page.history==='true'];
    const total=Number((await client.query(`SELECT count(*) ${from} WHERE ${filter}`,values)).rows[0].count);
    const items=(await client.query(`SELECT l.id,l.version,l.full_name,l.admission_number,c.name AS class_name ${from} WHERE ${filter} ORDER BY l.full_name,l.id LIMIT $5 OFFSET $6`,[...values,page.limit,page.offset])).rows;
    return {date,items,total,offset:page.offset,limit:page.limit};
  }
  private async learner(client:PoolClient,actor:Actor,id:string){
    const row=(await client.query('SELECT id,version,full_name,admission_number FROM learners WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,id])).rows[0];
    if(!row)throw new NotFoundException('Learner unavailable');return row;
  }
  private async eligible(client:PoolClient,actor:Actor,id:string,date:string,version:number){
    const learner=await this.learner(client,actor,id);
    if(learner.version!==version)throw new ConflictException('Learner changed. Reload collection records');
    const enrolment=(await client.query('SELECT e.id AS enrolment_id,c.id AS class_id,c.name AS class_name FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE e.school_id=$1 AND e.learner_id=$2 AND e.superseded_at IS NULL AND e.start_date<=$3::date AND (e.end_date IS NULL OR e.end_date>$3::date) AND y.start_date<=$3::date AND y.end_date>$3::date FOR SHARE OF c',[actor.schoolId,id,date])).rows[0];
    if(!enrolment)throw new ConflictException('Learner has no effective enrolment today');return {...learner,...enrolment};
  }
  async detail(client:PoolClient,actor:Actor,id:string,page:PageDto=new PageDto()){
    const learner=await this.learner(client,actor,id),date=await this.today(client);
    learner.class_name=(await client.query('SELECT c.name FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE e.school_id=$1 AND e.learner_id=$2 AND e.superseded_at IS NULL AND e.start_date<=$3::date AND (e.end_date IS NULL OR e.end_date>$3::date) AND y.start_date<=$3::date AND y.end_date>$3::date',[actor.schoolId,id,date])).rows[0]?.name??null;
    const collectors=learner.class_name?(await client.query('SELECT * FROM collection_pickup_authority($1,$2)',[actor.schoolId,id])).rows:[];
    const eventTotal=Number((await client.query('SELECT count(*) FROM collection_events WHERE school_id=$1 AND learner_id=$2',[actor.schoolId,id])).rows[0].count);
    const caseTotal=Number((await client.query('SELECT count(*) FROM collection_cases WHERE school_id=$1 AND learner_id=$2',[actor.schoolId,id])).rows[0].count);
    const events=(await client.query('SELECT id,date::text,learner_name,admission_number,class_name,collector_name,verification_reason,released_at,released_by,guardian_link_id,guardian_link_version,exception_id,voided_at,voided_by,void_reason,version FROM collection_events WHERE school_id=$1 AND learner_id=$2 ORDER BY released_at DESC,id LIMIT $3 OFFSET $4',[actor.schoolId,id,page.limit,page.offset])).rows;
    // Front desk sees the decision and expiry, not the headteacher's identity-verification notes.
    const cases=(await client.query(`SELECT id,date::text,collector_name,request_reason,status,version,decision_reason,${actor.role==='headteacher'?'review_verification,':''}reviewed_at,cancelled_at,cancellation_reason FROM collection_cases WHERE school_id=$1 AND learner_id=$2 ORDER BY requested_at DESC,id LIMIT $3 OFFSET $4`,[actor.schoolId,id,page.limit,page.offset])).rows;
    const activeEvent=(await client.query('SELECT id FROM collection_events WHERE school_id=$1 AND learner_id=$2 AND date=$3 AND voided_at IS NULL',[actor.schoolId,id,date])).rows[0]??null;
    return {date,learner,collectors,events,cases,activeEvent,history:{offset:page.offset,limit:page.limit,eventTotal,caseTotal}};
  }
  async createCase(client:PoolClient,actor:Actor,id:string,body:CollectionCaseDto){const outcome=await command(client,actor,body.operationId,'collection.case.create',{id,...body},async()=>{
    const date=await this.today(client);await this.eligible(client,actor,id,date,body.learnerVersion);
    if((await client.query('SELECT id FROM collection_events WHERE school_id=$1 AND learner_id=$2 AND date=$3 AND voided_at IS NULL',[actor.schoolId,id,date])).rowCount)throw new ConflictException('A release is already recorded today');
    const caseId=randomUUID();await client.query('INSERT INTO collection_cases(id,school_id,learner_id,date,collector_name,request_reason,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[caseId,actor.schoolId,id,date,body.collectorName.trim(),body.reason.trim(),actor.membershipId]);
    await audit(client,actor,'collection.case.pending',caseId,{learnerId:id,date});return {learnerId:id};
  });return this.detail(client,actor,outcome.learnerId);}
  async review(client:PoolClient,actor:Actor,id:string,body:CollectionReviewDto){const outcome=await command(client,actor,body.operationId,'collection.case.review',{id,...body},async()=>{
    const reference=(await client.query('SELECT learner_id FROM collection_cases WHERE school_id=$1 AND id=$2',[actor.schoolId,id])).rows[0];if(!reference)throw new NotFoundException('Collection request unavailable');
    const learner=await this.learner(client,actor,reference.learner_id),record=(await client.query('SELECT *,date::text FROM collection_cases WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,id])).rows[0],date=await this.today(client);
    if(record.version!==body.version)throw new ConflictException('Collection request changed. Reload before reviewing');
    if(body.action==='cancel'){
      if(record.status!=='approved')throw new ConflictException('Only an unused approval can be cancelled');
      await client.query("UPDATE collection_cases SET status='cancelled',version=version+1,cancelled_by=$1,cancelled_at=now(),cancellation_reason=$2 WHERE school_id=$3 AND id=$4",[actor.membershipId,body.reason.trim(),actor.schoolId,id]);
    }else{
      if(record.status!=='pending'||record.date!==date)throw new ConflictException('Only a pending request for today can be reviewed');
      if(body.action==='approve'){
        if(!body.verificationReason?.trim())throw new BadRequestException('Record the identity verification before approving collection');
        await this.eligible(client,actor,learner.id,date,learner.version);
        if((await client.query('SELECT id FROM collection_events WHERE school_id=$1 AND learner_id=$2 AND date=$3 AND voided_at IS NULL',[actor.schoolId,learner.id,date])).rowCount)throw new ConflictException('A release is already recorded today');
      }
      await client.query('UPDATE collection_cases SET status=$1,version=version+1,reviewed_by=$2,reviewed_at=now(),decision_reason=$3,review_verification=$4 WHERE school_id=$5 AND id=$6',[body.action==='approve'?'approved':'declined',actor.membershipId,body.reason.trim(),body.action==='approve'?body.verificationReason!.trim():null,actor.schoolId,id]);
    }
    await audit(client,actor,`collection.case.${body.action}`,id,{learnerId:learner.id,reason:body.reason.trim()});return {learnerId:learner.id};
  });return this.detail(client,actor,outcome.learnerId);}
  async release(client:PoolClient,actor:Actor,id:string,body:CollectionReleaseDto){const outcome=await command(client,actor,body.operationId,'collection.release',{id,...body},async()=>{
    if(Boolean(body.guardianLinkId)===Boolean(body.exceptionId)||Boolean(body.guardianLinkId)!==Boolean(body.guardianLinkVersion)||Boolean(body.exceptionId)!==Boolean(body.exceptionVersion))throw new BadRequestException('Select exactly one reviewed collection authority and its version');
    const date=await this.today(client),learner=await this.eligible(client,actor,id,date,body.learnerVersion);
    if((await client.query('SELECT id FROM collection_events WHERE school_id=$1 AND learner_id=$2 AND date=$3 AND voided_at IS NULL',[actor.schoolId,id,date])).rowCount)throw new ConflictException('A release is already recorded today');
    let collector:string;
    if(body.guardianLinkId){
      const link=(await client.query('SELECT * FROM collection_pickup_authority($1,$2,$3)',[actor.schoolId,id,body.guardianLinkId])).rows[0];
      if(!link)throw new NotFoundException('Verified pickup authority unavailable');if(link.version!==body.guardianLinkVersion)throw new ConflictException('Pickup authority changed. Reload before releasing');collector=link.collector_name;
    }else{
      const exception=(await client.query('SELECT *,date::text FROM collection_cases WHERE school_id=$1 AND learner_id=$2 AND id=$3 FOR UPDATE',[actor.schoolId,id,body.exceptionId])).rows[0];
      if(!exception)throw new NotFoundException('Collection approval unavailable');
      if(exception.status!=='approved'||exception.date!==date||exception.version!==body.exceptionVersion)throw new ConflictException('Collection approval is changed, expired or already used');
      if(!(await client.query('SELECT collection_live_reviewer($1,$2) AS allowed',[actor.schoolId,exception.reviewed_by])).rows[0].allowed)throw new ConflictException('Approving headteacher authority is no longer active');
      collector=exception.collector_name;
      await client.query("UPDATE collection_cases SET status='used',version=version+1 WHERE school_id=$1 AND id=$2",[actor.schoolId,exception.id]);
    }
    const eventId=randomUUID();await client.query('INSERT INTO collection_events(id,school_id,learner_id,date,learner_name,admission_number,class_id,class_name,enrolment_id,guardian_link_id,guardian_link_version,exception_id,collector_name,verification_reason,released_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[eventId,actor.schoolId,id,date,learner.full_name,learner.admission_number,learner.class_id,learner.class_name,learner.enrolment_id,body.guardianLinkId??null,body.guardianLinkVersion??null,body.exceptionId??null,collector,body.verificationReason.trim(),actor.membershipId]);
    await audit(client,actor,'collection.released',eventId,{learnerId:id,date,guardianLinkId:body.guardianLinkId??null,exceptionId:body.exceptionId??null});return {learnerId:id};
  });return this.detail(client,actor,outcome.learnerId);}
  async void(client:PoolClient,actor:Actor,id:string,body:CollectionVoidDto){const outcome=await command(client,actor,body.operationId,'collection.void',{id,...body},async()=>{
    const reference=(await client.query('SELECT learner_id FROM collection_events WHERE school_id=$1 AND id=$2',[actor.schoolId,id])).rows[0];if(!reference)throw new NotFoundException('Collection event unavailable');
    await this.learner(client,actor,reference.learner_id);
    const record=(await client.query('SELECT * FROM collection_events WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,id])).rows[0];if(record.voided_at||record.version!==body.version)throw new ConflictException('Collection event changed. Reload before correcting');
    await client.query('UPDATE collection_events SET voided_by=$1,voided_at=now(),void_reason=$2,version=version+1 WHERE school_id=$3 AND id=$4',[actor.membershipId,body.reason.trim(),actor.schoolId,id]);
    await audit(client,actor,'collection.entry.voided',id,{reason:body.reason.trim(),learnerId:reference.learner_id});return {learnerId:reference.learner_id};
  });return this.detail(client,actor,outcome.learnerId);}
}
