import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PageDto } from './learners.dto';
import { CommitImportDto,StageImportDto,ValidateImportDto } from './imports.dto';
import { LearnerImportsService } from './imports.service';
const staff=['headteacher','frontdesk'];
@Controller('api/v1/schools/:schoolId/learner-imports')
export class LearnerImportsController {
  constructor(private readonly access:Access,private readonly imports:LearnerImportsService){}
  @Get('classes')
  classes(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,staff,client=>this.imports.classes(client,schoolId,page));}
  @Get()
  list(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,staff,client=>this.imports.list(client,schoolId,page));}
  @Get(':id')
  view(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string){return this.access.school(req,schoolId,staff,client=>this.imports.view(client,schoolId,id));}
  @Post()
  stage(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:StageImportDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.imports.stage(client,actor,body),true);}
  @Post(':id/validate')
  validate(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:ValidateImportDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.imports.validate(client,actor,id,body),true);}
  @Post(':id/commit')
  commit(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:CommitImportDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.imports.commit(client,actor,id,body),true);}
}
