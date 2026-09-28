import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { AttendancePageDto,RegisterDto,SchoolDayDto } from './attendance.dto';
import { AttendanceService } from './attendance.service';
@Controller('api/v1/schools/:schoolId')
export class AttendanceController {
  constructor(private readonly access:Access,private readonly attendance:AttendanceService){}
  @Get('attendance/school-days') days(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:AttendancePageDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.attendance.days(client,actor,page));}
  @Post('attendance/school-days') setDay(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:SchoolDayDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.attendance.setDay(client,actor,body),true);}
  @Get('attendance/classes/:classId/register') register(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('classId',new ParseUUIDPipe()) classId:string,@Query() page:AttendancePageDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.attendance.register(client,actor,classId,page));}
  @Post('attendance/classes/:classId/register') save(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('classId',new ParseUUIDPipe()) classId:string,@Body() body:RegisterDto){return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor)=>this.attendance.save(client,actor,classId,body),true);}
}
