import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { LearnersService } from './learners.service';
import { AdmissionDto,ClassDto,ClassPageDto,PageDto,TransferDto,TransitionDto,WithdrawalDto,YearDto } from './learners.dto';
const staff=['headteacher','frontdesk'];
@Controller('api/v1/schools/:schoolId')
export class LearnersController {
  constructor(private readonly access:Access,private readonly learners:LearnersService){}
  @Get('academic-years')
  years(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:PageDto) {return this.access.school(req,schoolId,staff,client=>this.learners.years(client,schoolId,page));}
  @Post('academic-years')
  year(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Body() body:YearDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.learners.createYear(client,actor,body),true);}
  @Get('classes')
  classes(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:ClassPageDto) {return this.access.school(req,schoolId,staff,client=>this.learners.classes(client,schoolId,page));}
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
  @Post('learners/:id/withdraw')
  withdraw(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:WithdrawalDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.learners.withdraw(client,actor,id,body),true);}
}
