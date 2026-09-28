import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { LearnersService } from './learners.service';
import { AdmissionDto,ClassDto,PageDto,TransferDto,TransitionDto,YearDto } from './learners.dto';
const staff=['headteacher','frontdesk'];
@Controller('api/v1/schools/:schoolId')
export class LearnersController {
  constructor(private readonly access:Access,private readonly learners:LearnersService){}
  @Get('academic-years')
  years(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string) {return this.access.school(req,schoolId,staff,async client=>(await client.query('SELECT id,name,start_date::text,end_date::text FROM academic_years WHERE school_id=$1 ORDER BY start_date DESC LIMIT 100',[schoolId])).rows);}
  @Post('academic-years')
  year(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:YearDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.learners.createYear(client,actor,body),true);}
  @Get('classes')
  classes(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string) {return this.access.school(req,schoolId,staff,async client=>(await client.query('SELECT c.id,c.name,c.level,c.capacity,c.academic_year_id,y.name AS year_name,y.start_date::text,y.end_date::text FROM class_sections c JOIN academic_years y ON y.school_id=c.school_id AND y.id=c.academic_year_id WHERE c.school_id=$1 ORDER BY y.start_date DESC,c.name LIMIT 100',[schoolId])).rows);}
  @Post('classes')
  section(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:ClassDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.learners.createClass(client,actor,body),true);}
  @Get('admissions')
  applications(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto) {return this.access.school(req,schoolId,staff,client=>this.learners.page(client,schoolId,'admissions',page));}
  @Post('admissions')
  apply(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:AdmissionDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.createAdmission(client,actor,body),true);}
  @Post('admissions/:id/transition')
  transition(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:TransitionDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.transition(client,actor,id,body),true);}
  @Get('learners')
  list(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto){return this.access.school(req,schoolId,staff,client=>this.learners.page(client,schoolId,'learners',page));}
  @Get('learners/:id')
  detail(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string){return this.access.school(req,schoolId,staff,client=>this.learners.learner(client,schoolId,id));}
  @Post('learners/:id/transfer')
  transfer(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:TransferDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.transfer(client,actor,id,body),true);}
}
