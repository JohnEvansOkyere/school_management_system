import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { GuardianLinkDto,GuardianReviewDto } from './guardians.dto';
import { GuardiansService } from './guardians.service';
import { PageDto } from './learners.dto';
@Controller('api/v1/schools/:schoolId')
export class GuardiansController {
  constructor(private readonly access:Access,private readonly guardians:GuardiansService){}
  @Get('guardian-candidates')
  candidates(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string){return this.access.school(req,schoolId,['headteacher'],async client=>(await client.query('SELECT * FROM guardian_candidates($1)',[schoolId])).rows);}
  @Get('guardian-links')
  list(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.guardians.list(client,actor,page));}
  @Post('guardian-links')
  create(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:GuardianLinkDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.guardians.create(client,actor,body),true);}
  @Post('guardian-links/:id/verify')
  verify(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:GuardianReviewDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.guardians.review(client,actor,id,body,'verify'),true);}
  @Post('guardian-links/:id/revoke')
  revoke(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:GuardianReviewDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.guardians.review(client,actor,id,body,'revoke'),true);}
  @Get('guardian/children')
  children(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string){return this.access.school(req,schoolId,['guardian'],(client,actor)=>this.guardians.children(client,actor));}
  @Get('guardian/children/:id')
  child(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string){return this.access.school(req,schoolId,['guardian'],(client,actor)=>this.guardians.children(client,actor,id));}
}
