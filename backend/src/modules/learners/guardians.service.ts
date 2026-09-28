import { BadRequestException,ConflictException,Injectable,NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Actor } from '../../core/access';
import { audit,command } from '../../core/commands';
import { GuardianLinkDto,GuardianReviewDto } from './guardians.dto';
import { PageDto } from './learners.dto';
@Injectable()
export class GuardiansService {
  async list(client:PoolClient,actor:Actor,page:PageDto) {
    // Candidates deliberately expose no credentials, contact details or other schools.
    const search=`%${(page.search??'').trim().replace(/[\\%_]/g,'\\$&')}%`;
    const joins='FROM guardian_links g JOIN learners l ON l.school_id=g.school_id AND l.id=g.learner_id ';
    const filter="WHERE g.school_id=$1 AND (l.full_name ILIKE $2 ESCAPE '\\' OR l.admission_number ILIKE $2 ESCAPE '\\' OR g.guardian_display_name ILIKE $2 ESCAPE '\\')";
    const total=Number((await client.query(`SELECT count(*) ${joins} ${filter}`,[actor.schoolId,search])).rows[0].count);
    const items=(await client.query(`SELECT g.*,l.full_name AS learner_name,g.guardian_display_name AS guardian_name ${joins} ${filter} ORDER BY g.created_at DESC,g.id LIMIT $3 OFFSET $4`,[actor.schoolId,search,page.limit,page.offset])).rows;
    return {items,total,offset:page.offset,limit:page.limit};
  }
  create(client:PoolClient,actor:Actor,body:GuardianLinkDto) {
    return command(client,actor,body.operationId,'guardian.link.create',body,async()=>{
      if(![body.academic,body.billing,body.pickup,body.contact].some(Boolean))throw new BadRequestException('Select at least one guardian right');
      const learner=await client.query('SELECT id FROM learners WHERE school_id=$1 AND id=$2',[actor.schoolId,body.learnerId]);
      if(!learner.rowCount||!(await client.query('SELECT lock_guardian_membership($1,$2) AS allowed',[actor.schoolId,body.guardianMembershipId])).rows[0].allowed)throw new NotFoundException('Learner or guardian unavailable');
      const guardianName=(await client.query('SELECT display_name FROM guardian_candidates($1) WHERE id=$2',[actor.schoolId,body.guardianMembershipId])).rows[0].display_name;
      const link=(await client.query('INSERT INTO guardian_links(id,school_id,learner_id,guardian_membership_id,academic,billing,pickup,contact,guardian_display_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[randomUUID(),actor.schoolId,body.learnerId,body.guardianMembershipId,body.academic,body.billing,body.pickup,body.contact,guardianName])).rows[0];
      await audit(client,actor,'guardian.link.pending',link.id,{learnerId:body.learnerId});return link;
    });
  }
  review(client:PoolClient,actor:Actor,id:string,body:GuardianReviewDto,action:'verify'|'revoke') {
    return command(client,actor,body.operationId,`guardian.link.${action}`,{id,...body},async()=>{
      const result=await client.query('SELECT * FROM guardian_links WHERE school_id=$1 AND id=$2 FOR UPDATE',[actor.schoolId,id]);
      if(!result.rowCount)throw new NotFoundException('Guardian link unavailable');
      const link=result.rows[0];
      if(link.version!==body.version)throw new ConflictException('Guardian link changed. Reload before reviewing');
      if(link.revoked_at||action==='verify'&&link.verified_at)throw new ConflictException('This guardian link has already been reviewed');
      if(action==='verify'&&!(await client.query('SELECT lock_guardian_membership($1,$2) AS allowed',[actor.schoolId,link.guardian_membership_id])).rows[0].allowed)throw new NotFoundException('Guardian unavailable');
      const prefix=action==='verify'?'verified':'revoked',reason=action==='verify'?'verification_reason':'revocation_reason';
      const updated=(await client.query(`UPDATE guardian_links SET ${prefix}_at=now(),${prefix}_by=$1,${reason}=$2,version=version+1 WHERE school_id=$3 AND id=$4 RETURNING *`,[actor.membershipId,body.reason,actor.schoolId,id])).rows[0];
      await audit(client,actor,`guardian.link.${prefix}`,id,{learnerId:link.learner_id,reason:body.reason,version:updated.version});return updated;
    });
  }
  async children(client:PoolClient,actor:Actor,id?:string) {
    // Lock the rights row for the response transaction; revocation serializes with in-flight reads.
    const rows=(await client.query('SELECT l.id,l.full_name,l.admission_number,g.academic,g.billing,g.pickup,g.contact FROM guardian_links g JOIN learners l ON l.school_id=g.school_id AND l.id=g.learner_id WHERE g.school_id=$1 AND g.guardian_membership_id=$2 AND g.verified_at IS NOT NULL AND g.revoked_at IS NULL AND ($3::uuid IS NULL OR l.id=$3) ORDER BY l.full_name,l.id FOR SHARE OF g',[actor.schoolId,actor.membershipId,id??null])).rows;
    if(!id)return rows;
    if(!rows.length)throw new NotFoundException('Child unavailable');
    const child=rows[0];
    if(child.academic){
      child.date_of_birth=(await client.query('SELECT date_of_birth::text FROM learners WHERE school_id=$1 AND id=$2',[actor.schoolId,id])).rows[0].date_of_birth;
      child.enrolments=(await client.query('SELECT c.name AS class_name,e.start_date::text,e.end_date::text FROM enrolments e JOIN class_sections c ON c.school_id=e.school_id AND c.id=e.class_id WHERE e.school_id=$1 AND e.learner_id=$2 AND e.superseded_at IS NULL ORDER BY e.start_date,e.id',[actor.schoolId,id])).rows;
    }
    return child;
  }
}
