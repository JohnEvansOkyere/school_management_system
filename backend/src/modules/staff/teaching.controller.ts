import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PageDto } from '../learners/learners.dto';
import { TeachingService } from './teaching.service';
import { RevokeTeachingDto,RosterQueryDto,TeachingAssignmentDto } from './teaching.dto';
@Controller('api/v1/schools/:schoolId')
export class TeachingController {
  constructor(private readonly access:Access,private readonly teaching:TeachingService){}
  @Get('teacher-candidates')
  candidates(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string){return this.access.school(req,schoolId,['headteacher'],async client=>(await client.query('SELECT * FROM teacher_candidates($1)',[schoolId])).rows);}
  @Get('teaching/class-options')
  options(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.teaching.classes(client,actor,page));}
  @Get('teaching/assignments')
  assignments(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.teaching.assignments(client,actor,page));}
  @Post('teaching/assignments')
  create(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:TeachingAssignmentDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.teaching.create(client,actor,body),true);}
  @Post('teaching/assignments/:id/revoke')
  revoke(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:RevokeTeachingDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.teaching.revoke(client,actor,id,body),true);}
  @Get('teaching/classes')
  classes(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:RosterQueryDto){return this.access.school(req,schoolId,['teacher'],(client,actor)=>this.teaching.classes(client,actor,page,page.date));}
  @Get('teaching/classes/:id/roster')
  roster(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Query() page:RosterQueryDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.teaching.roster(client,actor,id,page));}
}
