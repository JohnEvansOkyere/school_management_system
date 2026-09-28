import { Body,Controller,Get,Param,ParseUUIDPipe,Patch,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { EarlyYearsReportCreateDto,EarlyYearsReportEditDto,EarlyYearsReportListDto,EarlyYearsReportRevisionDto,EarlyYearsReportTransitionDto } from './reports.dto';
import { EarlyYearsReportsService } from './reports.service';

@Controller('api/v1/schools/:schoolId')
export class EarlyYearsReportsController {
  constructor(private readonly access:Access,private readonly reports:EarlyYearsReportsService){}
  @Get('early-years/reports') list(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:EarlyYearsReportListDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.reports.list(client,actor,page));}
  @Post('early-years/reports') create(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:EarlyYearsReportCreateDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.reports.create(client,actor,body),true);}
  @Post('early-years/reports/:reportId/revisions') revise(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('reportId',new ParseUUIDPipe()) reportId:string,@Body() body:EarlyYearsReportRevisionDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.reports.revise(client,actor,reportId,body),true);}
  @Patch('early-years/report-revisions/:id') save(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:EarlyYearsReportEditDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.reports.save(client,actor,id,body),true);}
  @Post('early-years/report-revisions/:id/submit') submit(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:EarlyYearsReportTransitionDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.reports.submit(client,actor,id,body),true);}
  @Post('early-years/report-revisions/:id/return') returnForChanges(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:EarlyYearsReportTransitionDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.reports.returnForChanges(client,actor,id,body),true);}
  @Post('early-years/report-revisions/:id/approve') approve(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:EarlyYearsReportTransitionDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.reports.approve(client,actor,id,body),true);}
  @Post('early-years/report-revisions/:id/publish') publish(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:EarlyYearsReportTransitionDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.reports.publish(client,actor,id,body),true);}
  @Get('guardian/children/:learnerId/reports') guardianReports(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('learnerId',new ParseUUIDPipe()) learnerId:string){return this.access.school(req,schoolId,['guardian'],(client,actor)=>this.reports.guardianReports(client,actor,learnerId));}
}
