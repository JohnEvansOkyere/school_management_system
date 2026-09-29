import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { CorrectObservationDto,EarlyYearsClassesDto,EarlyYearsObservationDto,EarlyYearsPolicyDto,ObservationHistoryDto,PolicyTransitionDto } from './early-years.dto';
const pattern=(term?:string)=>`%${(term??'').trim().replace(/[\\%_]/g,'\\$&')}%`;
const dayToday="(now() AT TIME ZONE 'Africa/Accra')::date";
@Injectable()
export class EarlyYearsService {
  async classes(client:PoolClient,actor:Actor,query:EarlyYearsClassesDto){
    const params:any[]=[actor.schoolId,query.level,pattern(query.search)];let scope='';
    if(actor.role==='teacher'){
      const eligible=(await client.query(`SELECT class_id FROM teaching_assignments WHERE school_id=$1 AND teacher_membership_id=$2 AND revoked_at IS NULL AND start_date<=${dayToday} AND end_date>${dayToday} FOR SHARE`,[actor.schoolId,actor.membershipId])).rows.map(row=>row.class_id);
      params.push(eligible);scope=' AND c.id=ANY($4::uuid[])';
    }
    const from='FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id';
    const where=`c.school_id=$1 AND c.level=$2 AND (c.name ILIKE $3 ESCAPE '\\' OR y.name ILIKE $3 ESCAPE '\\')${scope}`;
    const total=Number((await client.query(`SELECT count(*) ${from} WHERE ${where}`,params)).rows[0].count);
    const items=(await client.query(`SELECT c.id,c.name,c.level,y.name year_name,y.start_date::text,y.end_date::text ${from} WHERE ${where} ORDER BY y.start_date DESC,c.name,c.id LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,query.limit,query.offset])).rows;
    return {items,total,offset:query.offset,limit:query.limit};
  }
  async policies(client:PoolClient,actor:Actor,level:string){
    if(!['Nursery','KG'].includes(level))throw new BadRequestException('Select Nursery or KG');
    const rows=(await client.query('SELECT id,level,title,source_kind,source_issuer,source_reference,source_version,effective_start::text,effective_end::text,specialist_name,specialist_qualification,specialist_review_reference,specialist_reviewed_on::text,status,version,approved_at,retired_at FROM early_years_policies WHERE school_id=$1 AND level=$2 ORDER BY effective_start DESC,id',[actor.schoolId,level])).rows;
    return {items:await Promise.all(rows.map(async row=>({...row,indicators:(await client.query('SELECT id,code,title,learning_area,strand,sub_strand,descriptors FROM early_years_indicators WHERE school_id=$1 AND policy_id=$2 ORDER BY code,id',[actor.schoolId,row.id])).rows}))) };
  }
  createPolicy(client:PoolClient,actor:Actor,body:EarlyYearsPolicyDto){return command(client,actor,body.operationId,'early-years.policy.create',body,async()=>{
    if(body.effectiveEnd&&body.effectiveEnd<=body.effectiveStart)throw new BadRequestException('Policy end date must be after its start date');
    if(body.level==='Nursery'&&(!body.specialistName||!body.specialistQualification||!body.specialistReviewReference||!body.specialistReviewedOn))throw new BadRequestException('Nursery policy requires school-supplied evidence of specialist review');
    if(body.level==='Nursery'){
      const today=(await client.query("SELECT (now() AT TIME ZONE 'Africa/Accra')::date::text AS today")).rows[0].today;
      if(body.specialistReviewedOn!>today||body.specialistReviewedOn!>body.effectiveStart)throw new BadRequestException('Nursery specialist review must be dated on or before today and the policy start');
    }
    if(new Set(body.indicators.map(i=>i.code.trim())).size!==body.indicators.length)throw new BadRequestException('Indicator codes must be unique within the policy');
    for(const indicator of body.indicators)if(new Set(indicator.descriptors.map(d=>d.id)).size!==indicator.descriptors.length)throw new BadRequestException('Descriptor identifiers must be unique within an indicator');
    const policyId=randomUUID();
    await client.query('INSERT INTO early_years_policies(id,school_id,level,title,source_kind,source_issuer,source_reference,source_version,effective_start,effective_end,specialist_name,specialist_qualification,specialist_review_reference,specialist_reviewed_on,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[policyId,actor.schoolId,body.level,body.title.trim(),body.sourceKind,body.sourceIssuer.trim(),body.sourceReference.trim(),body.sourceVersion.trim(),body.effectiveStart,body.effectiveEnd??null,body.specialistName?.trim()??null,body.specialistQualification?.trim()??null,body.specialistReviewReference?.trim()??null,body.specialistReviewedOn??null,actor.membershipId]);
    for(const item of body.indicators)await client.query('INSERT INTO early_years_indicators(id,school_id,policy_id,code,title,learning_area,strand,sub_strand,descriptors) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),actor.schoolId,policyId,item.code.trim(),item.title.trim(),item.learningArea.trim(),item.strand.trim(),item.subStrand.trim(),JSON.stringify(item.descriptors.map(d=>({id:d.id,text:d.text.trim()})))]);
    await audit(client,actor,'early-years.policy.created',policyId,{level:body.level,sourceKind:body.sourceKind,indicatorCount:body.indicators.length,sourceReference:body.sourceReference});return {id:policyId,status:'draft',version:1,level:body.level};
  });}
  transition(client:PoolClient,actor:Actor,id:string,body:PolicyTransitionDto,retire=false){return command(client,actor,body.operationId,retire?'early-years.policy.retire':'early-years.policy.approve',{id,...body},async()=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.schoolId}:early-years:${id}`]);
    const policy=(await client.query('SELECT * FROM early_years_policies WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,id])).rows[0];
    if(!policy)throw new NotFoundException('Early-years policy unavailable');
    if(policy.version!==body.version)throw new ConflictException('Policy changed. Reload before review');
    if(retire){if(policy.status!=='approved'||!body.reason)throw new ConflictException('Only approved policies can be retired with a reason');
      const updated=(await client.query("UPDATE early_years_policies SET status='retired',retired_by=$1,retired_at=now(),retirement_reason=$2,version=version+1 WHERE school_id=$3 AND id=$4 RETURNING id,status,version",[actor.membershipId,body.reason,actor.schoolId,id])).rows[0];await audit(client,actor,'early-years.policy.retired',id,{reason:body.reason,version:updated.version});return updated;}
    if(policy.status!=='draft')throw new ConflictException('Only draft policies can be approved');
    const count=Number((await client.query('SELECT count(*) FROM early_years_indicators WHERE school_id=$1 AND policy_id=$2',[actor.schoolId,id])).rows[0].count);if(!count)throw new BadRequestException('Policy requires at least one indicator');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.schoolId}:early-years-level:${policy.level}`]);
    const overlap=(await client.query("SELECT 1 FROM early_years_policies WHERE school_id=$1 AND level=$2 AND status='approved' AND daterange(effective_start,effective_end,'[)') && daterange($3::date,$4::date,'[)') LIMIT 1",[actor.schoolId,policy.level,policy.effective_start,policy.effective_end])).rowCount;
    if(overlap)throw new ConflictException('Another approved policy covers part of these dates');
    const updated=(await client.query("UPDATE early_years_policies SET status='approved',approved_by=$1,approved_at=now(),version=version+1 WHERE school_id=$2 AND id=$3 RETURNING id,status,version",[actor.membershipId,actor.schoolId,id])).rows[0];await audit(client,actor,'early-years.policy.approved',id,{level:policy.level,sourceReference:policy.source_reference,schoolSuppliedReviewEvidence:policy.level==='Nursery',version:updated.version});return updated;
  });}
  observe(client:PoolClient,actor:Actor,classId:string,body:EarlyYearsObservationDto){return command(client,actor,body.operationId,'early-years.observation.create',{classId,...body},async()=>{
    if(body.observedOn>new Date().toLocaleDateString('sv-SE',{timeZone:'Africa/Accra'}))throw new BadRequestException('Observations cannot be dated in the future');
    if(new Set(body.entries.map(e=>e.indicatorId)).size!==body.entries.length)throw new BadRequestException('Each indicator can appear only once');
    const learner=(await client.query('SELECT id FROM learners WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,body.learnerId])).rows[0];if(!learner)throw new NotFoundException('Learner unavailable');
    const enrolment=(await client.query('SELECT e.id,e.class_id,e.start_date::text,e.end_date::text,c.level,c.name class_name,y.name year_name,y.start_date::text year_start,y.end_date::text year_end FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE e.school_id=$1 AND e.id=$2 AND e.learner_id=$3 AND e.superseded_at IS NULL AND e.start_date<=$4 AND (e.end_date IS NULL OR e.end_date>$4) FOR SHARE OF e,c',[actor.schoolId,body.enrolmentId,body.learnerId,body.observedOn])).rows[0];
    if(!enrolment||enrolment.class_id!==classId||!['Nursery','KG'].includes(enrolment.level)||body.observedOn<enrolment.year_start||body.observedOn>=enrolment.year_end)throw new NotFoundException('Learner enrolment unavailable for this observation date');
    if(actor.role==='teacher'){
      const grant=(await client.query(`SELECT id FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND teacher_membership_id=$3 AND revoked_at IS NULL AND start_date<=$4 AND end_date>$4 AND start_date<=${dayToday} AND end_date>${dayToday} FOR SHARE`,[actor.schoolId,enrolment.class_id,actor.membershipId,body.observedOn])).rowCount;
      if(!grant)throw new NotFoundException('Observation unavailable');
    }else if(actor.role!=='headteacher')throw new ForbiddenException('Only assigned educators and headteachers can record observations');
    const policy=(await client.query("SELECT * FROM early_years_policies WHERE school_id=$1 AND id=$2 AND level=$3 AND status='approved' AND effective_start<=$4 AND (effective_end IS NULL OR effective_end>$4) FOR SHARE",[actor.schoolId,body.policyId,enrolment.level,body.observedOn])).rows[0];if(!policy)throw new BadRequestException('No approved policy of this level is effective on the observation date');
    const indicators=(await client.query('SELECT id,code,title,learning_area,strand,sub_strand,descriptors FROM early_years_indicators WHERE school_id=$1 AND policy_id=$2',[actor.schoolId,policy.id])).rows;const byId=new Map(indicators.map(i=>[i.id,i]));
    if(body.entries.some(entry=>!byId.has(entry.indicatorId)))throw new BadRequestException('Entries must refer to indicators in the selected policy');
    const entries=body.entries.map(entry=>{const indicator=byId.get(entry.indicatorId);const descriptor=indicator.descriptors.find((d:any)=>d.id===entry.descriptorId);if(entry.status==='observed'&&(!descriptor||!entry.evidence?.trim()))throw new BadRequestException('Observed indicators require a listed descriptor and factual evidence');if(entry.status==='not_observed'&&(entry.descriptorId||entry.evidence))throw new BadRequestException('Not observed means there is no evidence or descriptor to record');return {indicatorId:indicator.id,code:indicator.code,title:indicator.title,learningArea:indicator.learning_area,strand:indicator.strand,subStrand:indicator.sub_strand,status:entry.status,descriptor:descriptor?{id:descriptor.id,text:descriptor.text}:null,evidence:entry.evidence?.trim()??null};});
    const name=(await client.query('SELECT full_name FROM learners WHERE school_id=$1 AND id=$2',[actor.schoolId,body.learnerId])).rows[0].full_name;
    const educatorName=actor.displayName;if(!educatorName)throw new NotFoundException('Educator unavailable');
    const snapshot={level:policy.level,title:policy.title,sourceKind:policy.source_kind,sourceIssuer:policy.source_issuer,sourceReference:policy.source_reference,sourceVersion:policy.source_version,indicators};
    const id=randomUUID();await client.query('INSERT INTO early_years_observations(id,school_id,learner_id,class_id,enrolment_id,level,observed_on,educator_membership_id,educator_display_name,recorded_by_membership_id,policy_id,policy_version,policy_snapshot,entries) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[id,actor.schoolId,body.learnerId,enrolment.class_id,body.enrolmentId,enrolment.level,body.observedOn,actor.membershipId,educatorName,actor.membershipId,policy.id,policy.version,JSON.stringify({...snapshot,learnerName:name,className:enrolment.class_name,yearName:enrolment.year_name}),JSON.stringify(entries)]);
    await audit(client,actor,'early-years.observation.created',id,{level:enrolment.level,observedOn:body.observedOn,policyId:policy.id,entryCount:entries.length});return {id,learnerId:body.learnerId,observedOn:body.observedOn,level:enrolment.level,version:1,status:'current'};
  });}
  correct(client:PoolClient,actor:Actor,id:string,body:CorrectObservationDto){return command(client,actor,body.operationId,'early-years.observation.correct',{id,...body},async()=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${actor.schoolId}:early-years-observation:${id}`]);
    const reference=(await client.query('SELECT learner_id,class_id,observed_on,educator_membership_id FROM early_years_observations WHERE school_id=$1 AND id=$2',[actor.schoolId,id])).rows[0];if(!reference)throw new NotFoundException('Observation unavailable');
    await client.query('SELECT id FROM learners WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,reference.learner_id]);
    await client.query('SELECT id FROM class_sections WHERE school_id=$1 AND id=$2 FOR SHARE',[actor.schoolId,reference.class_id]);
    if(actor.role==='teacher'){
      if(reference.educator_membership_id!==actor.membershipId)throw new NotFoundException('Observation unavailable');
      const grant=(await client.query(`SELECT id FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND teacher_membership_id=$3 AND revoked_at IS NULL AND start_date<=$4 AND end_date>$4 AND start_date<=${dayToday} AND end_date>${dayToday} FOR SHARE`,[actor.schoolId,reference.class_id,actor.membershipId,reference.observed_on])).rowCount;
      if(!grant)throw new NotFoundException('Observation unavailable');
    }else if(actor.role!=='headteacher')throw new ForbiddenException('Only educators and headteachers can correct observations');
    const original=(await client.query('SELECT * FROM early_years_observations o WHERE o.school_id=$1 AND o.id=$2 AND NOT EXISTS(SELECT 1 FROM early_years_observations n WHERE n.school_id=o.school_id AND n.supersedes_id=o.id)',[actor.schoolId,id])).rows[0];
    if(!original)throw new ConflictException('A newer observation version exists');
    if(original.version!==body.version)throw new ConflictException('Observation changed. Reload before correcting');
    const indicators=new Map<string,any>(original.policy_snapshot.indicators.map((item:any)=>[item.id,item] as [string,any]));
    if(new Set(body.entries.map(e=>e.indicatorId)).size!==body.entries.length||body.entries.some(e=>!indicators.has(e.indicatorId)))throw new BadRequestException('Corrections must use unique indicators from the recorded policy version');
    const entries=body.entries.map(entry=>{const indicator=indicators.get(entry.indicatorId);const descriptor=indicator.descriptors.find((d:any)=>d.id===entry.descriptorId);if(entry.status==='observed'&&(!descriptor||!entry.evidence?.trim()))throw new BadRequestException('Observed indicators require a listed descriptor and factual evidence');if(entry.status==='not_observed'&&(entry.descriptorId||entry.evidence))throw new BadRequestException('Not observed means there is no evidence or descriptor to record');return {indicatorId:indicator.id,code:indicator.code,title:indicator.title,learningArea:indicator.learning_area,strand:indicator.strand,subStrand:indicator.sub_strand,status:entry.status,descriptor:descriptor?{id:descriptor.id,text:descriptor.text}:null,evidence:entry.evidence?.trim()??null};});
    const next=original.version+1,newId=randomUUID();
    await client.query('INSERT INTO early_years_observations(id,school_id,learner_id,class_id,enrolment_id,level,observed_on,educator_membership_id,educator_display_name,recorded_by_membership_id,policy_id,policy_version,policy_snapshot,entries,version,supersedes_id,correction_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',[newId,actor.schoolId,original.learner_id,original.class_id,original.enrolment_id,original.level,original.observed_on,original.educator_membership_id,original.educator_display_name,actor.membershipId,original.policy_id,original.policy_version,JSON.stringify(original.policy_snapshot),JSON.stringify(entries),next,id,body.correctionReason.trim()]);
    await audit(client,actor,'early-years.observation.corrected',newId,{supersedesId:id,version:next,reason:body.correctionReason.trim()});return {id:newId,learnerId:original.learner_id,observedOn:original.observed_on,level:original.level,version:next,supersedesId:id,status:'current'};
  });}
  async history(client:PoolClient,actor:Actor,page:ObservationHistoryDto){
    if(!page.learnerId&&!page.classId)throw new BadRequestException('Select a learner or class');
    const values:any[]=[actor.schoolId];let where='o.school_id=$1';
    if(page.learnerId){values.push(page.learnerId);where+=` AND o.learner_id=$${values.length}`;}
    if(page.classId){values.push(page.classId);where+=` AND o.class_id=$${values.length}`;}
    if(actor.role==='teacher'){
      const memberParam=values.length+1,targetFilter=where.replaceAll('o.','candidate.');
      const grants=(await client.query(`SELECT t.id,t.class_id,t.start_date::text,t.end_date::text FROM teaching_assignments t WHERE t.school_id=$1 AND t.teacher_membership_id=$${memberParam} AND t.revoked_at IS NULL AND t.start_date<=${dayToday} AND t.end_date>${dayToday} AND EXISTS(SELECT 1 FROM early_years_observations candidate WHERE candidate.school_id=t.school_id AND candidate.class_id=t.class_id AND candidate.observed_on>=t.start_date AND candidate.observed_on<t.end_date AND ${targetFilter}) FOR SHARE OF t`,[...values,actor.membershipId])).rows;
      values.push(grants.map(row=>row.id));const grantIdsParam=values.length;
      where+=` AND EXISTS(SELECT 1 FROM teaching_assignments t WHERE t.school_id=o.school_id AND t.class_id=o.class_id AND t.id=ANY($${grantIdsParam}::uuid[]) AND t.start_date<=o.observed_on AND t.end_date>o.observed_on)`;
    }else if(actor.role!=='headteacher')throw new ForbiddenException('Only educators and headteachers can access observations');
    const total=Number((await client.query(`SELECT count(*) FROM early_years_observations o WHERE ${where}`,values)).rows[0].count);
    const rows=(await client.query(`SELECT o.id,o.learner_id,o.class_id,o.enrolment_id,o.level,o.observed_on::text,o.educator_membership_id,o.educator_display_name,o.recorded_by_membership_id,o.policy_id,o.policy_version,o.policy_snapshot,o.entries,o.version,o.supersedes_id,o.correction_reason,o.created_at,NOT EXISTS(SELECT 1 FROM early_years_observations next WHERE next.school_id=o.school_id AND next.supersedes_id=o.id) AS is_current FROM early_years_observations o WHERE ${where} ORDER BY o.observed_on DESC,o.created_at DESC,o.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,page.limit,page.offset])).rows;
    return {items:rows,total,offset:page.offset,limit:page.limit};
  }
}
