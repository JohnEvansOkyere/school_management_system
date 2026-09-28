import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { CorrectObservationDto,EarlyYearsClassesDto,EarlyYearsObservationDto,EarlyYearsPolicyDto,ObservationHistoryDto,PolicyTransitionDto } from './early-years.dto';
import { EarlyYearsService } from './early-years.service';
@Controller('api/v1/schools/:schoolId')
export class EarlyYearsController {
  constructor(private readonly access:Access,private readonly earlyYears:EarlyYearsService){}
  @Get('early-years/classes') classes(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() query:EarlyYearsClassesDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.earlyYears.classes(client,actor,query));}
  @Get('early-years/policies') policies(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query('level') level:string){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.earlyYears.policies(client,actor,level));}
  @Post('early-years/policies') createPolicy(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:EarlyYearsPolicyDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.earlyYears.createPolicy(client,actor,body),true);}
  @Post('early-years/policies/:id/approve') approve(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:PolicyTransitionDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.earlyYears.transition(client,actor,id,body),true);}
  @Post('early-years/policies/:id/retire') retire(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:PolicyTransitionDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.earlyYears.transition(client,actor,id,body,true),true);}
  @Post('early-years/classes/:classId/observations') observe(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('classId',new ParseUUIDPipe()) classId:string,@Body() body:EarlyYearsObservationDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.earlyYears.observe(client,actor,classId,body),true);}
  @Post('early-years/observations/:id/correct') correct(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:CorrectObservationDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.earlyYears.correct(client,actor,id,body),true);}
  @Get('early-years/observations') history(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:ObservationHistoryDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.earlyYears.history(client,actor,page));}
}
