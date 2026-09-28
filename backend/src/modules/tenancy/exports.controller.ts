import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, ConflictException, NotFoundException } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Access } from '../../core/access';
class ExportDto { @IsUUID() operationId!:string }
@Controller('api/v1/schools/:schoolId/audit-exports')
export class ExportsController {
  constructor(private readonly access:Access){}
  @Post()
  create(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:ExportDto) {
    return this.access.school(req,schoolId,['headteacher'],async(client,actor)=>{
      const inserted=await client.query("INSERT INTO outbox_jobs(id,school_id,actor_membership_id,actor_user_id,kind) VALUES($1,$2,$3,$4,'audit.export') ON CONFLICT(id) DO NOTHING RETURNING id,state",[body.operationId,schoolId,actor.membershipId,actor.userId]);
      if(inserted.rowCount) {
        await client.query("INSERT INTO audit_events(id,school_id,actor_membership_id,action,target_id) VALUES($1,$2,$3,'audit.export.requested',$4)",[randomUUID(),schoolId,actor.membershipId,body.operationId]);
        return inserted.rows[0];
      }
      const prior=await client.query("SELECT id,state FROM outbox_jobs WHERE id=$1 AND school_id=$2 AND actor_membership_id=$3 AND kind='audit.export'",[body.operationId,schoolId,actor.membershipId]);
      if(!prior.rowCount)throw new ConflictException('Operation ID already used');return prior.rows[0];
    },true);
  }
  @Get(':jobId')
  status(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('jobId',new ParseUUIDPipe()) jobId:string) {
    return this.access.school(req,schoolId,['headteacher'],async(client,actor)=>{
      const job=await client.query("SELECT id,state,attempts,last_error,result FROM outbox_jobs WHERE school_id=$1 AND id=$2 AND actor_membership_id=$3 AND kind='audit.export'",[schoolId,jobId,actor.membershipId]);
      if(!job.rowCount)throw new NotFoundException('Export unavailable');return job.rows[0];
    });
  }
}
