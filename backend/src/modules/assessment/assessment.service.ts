import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit, command } from '../../core/commands';
import { PolicyDto, PublishDto, RecordScoresDto, SubjectDto, TermDto } from './assessment.dto';

type Policy = { ca_weight: number; exam_weight: number; bands: { min: number; grade: string; remark: string }[]; source_note: string; version: number };
type Learner = { id: string; full_name: string; admission_number: string };
type Entry = { learner_id: string; subject_id: string; kind: string; score: number };

// Integer arithmetic in hundredths so weighted totals round half-up to one decimal without float drift.
export function weightedTotal(ca: number, exam: number, policy: Pick<Policy, 'ca_weight' | 'exam_weight'>) {
  const numerator = Math.round(ca * 100) * policy.ca_weight + Math.round(exam * 100) * policy.exam_weight;
  return Math.floor((numerator + 500) / 1000) / 10;
}
export function gradeFor(total: number, bands: Policy['bands']) {
  const ordered = [...bands].sort((a, b) => b.min - a.min);
  return ordered.find(band => total >= band.min) ?? ordered[ordered.length - 1];
}

@Injectable()
export class AssessmentService {
  async policy(client: PoolClient, schoolId: string) {
    return (await client.query('SELECT ca_weight,exam_weight,bands,source_note,version FROM assessment_policies WHERE school_id=$1',[schoolId])).rows[0] as Policy | undefined;
  }
  async setPolicy(client: PoolClient, actor: Actor, body: PolicyDto) {
    if (body.caWeight + body.examWeight !== 100) throw new BadRequestException('Continuous assessment and exam weights must add up to 100');
    const mins = body.bands.map(band => band.min);
    if (new Set(mins).size !== mins.length || !mins.includes(0)) throw new BadRequestException('Grade bands need distinct minimum scores and one starting at 0');
    return command(client,actor,body.operationId,'assessment.policy',body,async () => {
      const current = await this.policy(client,actor.schoolId);
      if (current && body.version !== current.version) throw new ConflictException('The assessment policy changed. Reload before saving');
      const values = [actor.schoolId,body.caWeight,body.examWeight,JSON.stringify(body.bands),body.sourceNote.trim(),actor.membershipId];
      const row = current
        ? (await client.query('UPDATE assessment_policies SET ca_weight=$2,exam_weight=$3,bands=$4,source_note=$5,updated_by=$6,updated_at=now(),version=version+1 WHERE school_id=$1 RETURNING ca_weight,exam_weight,bands,source_note,version',values)).rows[0]
        : (await client.query('INSERT INTO assessment_policies(school_id,ca_weight,exam_weight,bands,source_note,updated_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING ca_weight,exam_weight,bands,source_note,version',values)).rows[0];
      await audit(client,actor,'assessment.policy.saved',actor.schoolId,{version:row.version});
      return row;
    });
  }
  createSubject(client: PoolClient, actor: Actor, body: SubjectDto) {
    return command(client,actor,body.operationId,'assessment.subject',body,async () => {
      const row = (await client.query('INSERT INTO subjects(id,school_id,name) VALUES($1,$2,$3) RETURNING id,name',[randomUUID(),actor.schoolId,body.name.trim()])).rows[0];
      await audit(client,actor,'assessment.subject.created',row.id);
      return row;
    });
  }
  createTerm(client: PoolClient, actor: Actor, body: TermDto) {
    return command(client,actor,body.operationId,'assessment.term',body,async () => {
      const year = (await client.query('SELECT start_date::text,end_date::text FROM academic_years WHERE school_id=$1 AND id=$2',[actor.schoolId,body.academicYearId])).rows[0];
      if (!year) throw new NotFoundException('Academic year unavailable');
      if (body.startDate < year.start_date || body.endDate > year.end_date) throw new BadRequestException('A term must sit inside its academic year');
      const row = (await client.query('INSERT INTO terms(id,school_id,academic_year_id,name,start_date,end_date) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,academic_year_id,name,start_date::text,end_date::text',[randomUUID(),actor.schoolId,body.academicYearId,body.name.trim(),body.startDate,body.endDate])).rows[0];
      await audit(client,actor,'assessment.term.created',row.id);
      return row;
    });
  }
  private async term(client: PoolClient, schoolId: string, termId: string) {
    const term = (await client.query('SELECT id,name,start_date::text,end_date::text FROM terms WHERE school_id=$1 AND id=$2',[schoolId,termId])).rows[0];
    if (!term) throw new NotFoundException('Term unavailable');
    return term;
  }
  // Heads may work on any class; teachers only on a class they are live-assigned to today.
  async classFor(client: PoolClient, actor: Actor, classId: string) {
    const section = (await client.query('SELECT c.id,c.name,c.level FROM class_sections c WHERE c.school_id=$1 AND c.id=$2',[actor.schoolId,classId])).rows[0];
    if (!section) throw new NotFoundException('Class unavailable');
    if (actor.role === 'teacher') {
      const live = await client.query("SELECT 1 FROM teaching_assignments WHERE school_id=$1 AND class_id=$2 AND teacher_membership_id=$3 AND revoked_at IS NULL AND start_date<=(now() AT TIME ZONE 'Africa/Accra')::date AND end_date>(now() AT TIME ZONE 'Africa/Accra')::date",[actor.schoolId,classId,actor.membershipId]);
      if (!live.rowCount) throw new NotFoundException('Class unavailable');
    } else if (actor.role !== 'headteacher') throw new ForbiddenException('Your role cannot perform this action');
    return section;
  }
  private async learners(client: PoolClient, schoolId: string, classId: string, term: { start_date: string; end_date: string }) {
    return (await client.query(`SELECT DISTINCT l.id,l.full_name,l.admission_number FROM enrolments e JOIN learners l ON l.school_id=e.school_id AND l.id=e.learner_id
      WHERE e.school_id=$1 AND e.class_id=$2 AND e.superseded_at IS NULL AND e.start_date<$4 AND (e.end_date IS NULL OR e.end_date>$3) ORDER BY l.full_name,l.id`,[schoolId,classId,term.start_date,term.end_date])).rows as Learner[];
  }
  private async latest(client: PoolClient, schoolId: string, termId: string, classId: string) {
    return (await client.query('SELECT DISTINCT ON (learner_id,subject_id,kind) learner_id,subject_id,kind,score::float AS score FROM assessment_score_entries WHERE school_id=$1 AND term_id=$2 AND class_id=$3 ORDER BY learner_id,subject_id,kind,created_at DESC,id DESC',[schoolId,termId,classId])).rows as Entry[];
  }
  async grid(client: PoolClient, actor: Actor, classId: string, termId: string, subjectId?: string) {
    const section = await this.classFor(client,actor,classId), term = await this.term(client,actor.schoolId,termId);
    const learners = await this.learners(client,actor.schoolId,classId,term);
    const entries = (await this.latest(client,actor.schoolId,termId,classId)).filter(entry => !subjectId || entry.subject_id === subjectId);
    const published = new Set((await client.query('SELECT learner_id FROM terminal_reports WHERE school_id=$1 AND term_id=$2 AND class_id=$3',[actor.schoolId,termId,classId])).rows.map(row => row.learner_id));
    return {class:section,term,policy:(await this.policy(client,actor.schoolId)) ?? null,items:learners.map(learner => ({
      learnerId:learner.id,fullName:learner.full_name,admissionNumber:learner.admission_number,locked:published.has(learner.id),
      ca:entries.find(e => e.learner_id === learner.id && e.kind === 'ca')?.score ?? null,exam:entries.find(e => e.learner_id === learner.id && e.kind === 'exam')?.score ?? null,
    }))};
  }
  record(client: PoolClient, actor: Actor, classId: string, body: RecordScoresDto) {
    return command(client,actor,body.operationId,'assessment.scores',{classId,...body},async () => {
      await this.classFor(client,actor,classId);
      if (!(await this.policy(client,actor.schoolId))) throw new ConflictException('Set the school assessment policy before recording scores');
      const term = await this.term(client,actor.schoolId,body.termId);
      if (!(await client.query('SELECT 1 FROM subjects WHERE school_id=$1 AND id=$2',[actor.schoolId,body.subjectId])).rowCount) throw new NotFoundException('Subject unavailable');
      const eligible = new Set((await this.learners(client,actor.schoolId,classId,term)).map(learner => learner.id));
      const keys = body.scores.map(score => `${score.learnerId}:${score.kind}`);
      if (new Set(keys).size !== keys.length) throw new BadRequestException('Each learner and score type may appear once');
      if (body.scores.some(score => !eligible.has(score.learnerId))) throw new NotFoundException('A learner is not in this class for the term');
      const current = new Map((await this.latest(client,actor.schoolId,body.termId,classId)).filter(entry => entry.subject_id === body.subjectId).map(entry => [`${entry.learner_id}:${entry.kind}`,entry.score]));
      let written = 0;
      for (const score of body.scores) {
        if (current.get(`${score.learnerId}:${score.kind}`) === score.score) continue;
        await client.query('INSERT INTO assessment_score_entries(id,school_id,term_id,class_id,subject_id,learner_id,kind,score,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),actor.schoolId,body.termId,classId,body.subjectId,score.learnerId,score.kind,score.score,actor.membershipId]);
        written++;
      }
      await audit(client,actor,'assessment.scores.recorded',classId,{termId:body.termId,subjectId:body.subjectId,written});
      return {written,unchanged:body.scores.length - written};
    }).catch(error => { if ((error as {code?:string}).code === '23514') throw new ConflictException((error as Error).message); throw error; });
  }
  // Deterministic results: the only place totals, grades and positions are computed.
  async results(client: PoolClient, actor: Actor, classId: string, termId: string) {
    const section = await this.classFor(client,actor,classId), term = await this.term(client,actor.schoolId,termId);
    const policy = await this.policy(client,actor.schoolId);
    if (!policy) throw new ConflictException('Set the school assessment policy first');
    const learners = await this.learners(client,actor.schoolId,classId,term), entries = await this.latest(client,actor.schoolId,termId,classId);
    const subjectIds = [...new Set(entries.map(entry => entry.subject_id))];
    const names = new Map((await client.query('SELECT id,name FROM subjects WHERE school_id=$1 AND id=ANY($2::uuid[]) ORDER BY name',[actor.schoolId,subjectIds])).rows.map(row => [row.id,row.name as string]));
    const ordered = [...names.keys()];
    const rows = learners.map(learner => {
      const subjects = ordered.map(subjectId => {
        const ca = entries.find(e => e.learner_id === learner.id && e.subject_id === subjectId && e.kind === 'ca')?.score, exam = entries.find(e => e.learner_id === learner.id && e.subject_id === subjectId && e.kind === 'exam')?.score;
        const total = ca === undefined || exam === undefined ? null : weightedTotal(ca,exam,policy);
        const band = total === null ? null : gradeFor(total,policy.bands);
        return {subjectId,name:names.get(subjectId)!,ca:ca ?? null,exam:exam ?? null,total,grade:band?.grade ?? null,remark:band?.remark ?? null};
      });
      const complete = subjects.length > 0 && subjects.every(subject => subject.total !== null);
      const average = complete ? Math.round(subjects.reduce((sum,subject) => sum + subject.total!*10,0) / subjects.length) / 10 : null;
      return {learnerId:learner.id,fullName:learner.full_name,admissionNumber:learner.admission_number,subjects,complete,average,position:null as number | null};
    });
    const ranked = rows.filter(row => row.complete).sort((a,b) => b.average! - a.average!);
    ranked.forEach((row,index) => { row.position = index > 0 && row.average === ranked[index - 1].average ? ranked[index - 1].position : index + 1; });
    return {class:section,term,policy:{caWeight:policy.ca_weight,examWeight:policy.exam_weight,bands:policy.bands,sourceNote:policy.source_note},classSize:rows.length,items:rows};
  }
  publish(client: PoolClient, actor: Actor, classId: string, body: PublishDto) {
    return command(client,actor,body.operationId,'assessment.publish',{classId,...body},async () => {
      const results = await this.results(client,actor,classId,body.termId);
      if (!results.items.length || !results.items.some(row => row.subjects.length)) throw new ConflictException('There are no scores to publish for this class and term');
      const incomplete = results.items.filter(row => !row.complete).length;
      if (incomplete && !body.acknowledgeIncomplete) throw new ConflictException(`${incomplete} learner(s) have missing scores. Complete them or acknowledge publishing incomplete reports`);
      const already = new Set((await client.query('SELECT learner_id FROM terminal_reports WHERE school_id=$1 AND term_id=$2 AND class_id=$3',[actor.schoolId,body.termId,classId])).rows.map(row => row.learner_id));
      let published = 0;
      for (const row of results.items) {
        if (already.has(row.learnerId)) continue;
        const snapshot = {term:results.term,class:results.class,classSize:results.classSize,policy:results.policy,learner:{id:row.learnerId,fullName:row.fullName,admissionNumber:row.admissionNumber},subjects:row.subjects,average:row.average,position:row.position,complete:row.complete};
        await client.query('INSERT INTO terminal_reports(id,school_id,term_id,class_id,learner_id,snapshot,published_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),actor.schoolId,body.termId,classId,row.learnerId,JSON.stringify(snapshot),actor.membershipId]);
        published++;
      }
      await audit(client,actor,'assessment.reports.published',classId,{termId:body.termId,published,incomplete});
      return {published,alreadyPublished:already.size,incomplete};
    });
  }
  async guardianReports(client: PoolClient, actor: Actor, learnerId: string) {
    const link = (await client.query('SELECT id FROM guardian_links WHERE school_id=$1 AND learner_id=$2 AND guardian_membership_id=$3 AND academic=true AND verified_at IS NOT NULL AND revoked_at IS NULL FOR SHARE',[actor.schoolId,learnerId,actor.membershipId])).rows[0];
    if (!link) throw new NotFoundException('Child unavailable');
    return {items:(await client.query('SELECT id,term_id,snapshot,published_at FROM terminal_reports WHERE school_id=$1 AND learner_id=$2 ORDER BY published_at DESC,id',[actor.schoolId,learnerId])).rows};
  }
}
