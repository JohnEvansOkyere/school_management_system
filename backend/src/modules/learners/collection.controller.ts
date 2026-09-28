import { Body,Controller,Get,Param,ParseUUIDPipe,Post,Query,Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { PageDto } from './learners.dto';
import { CollectionService } from './collection.service';
import { CollectionCaseDto,CollectionReleaseDto,CollectionReviewDto,CollectionRosterDto,CollectionVoidDto } from './collection.dto';
const staff=['headteacher','frontdesk'];
@Controller('api/v1/schools/:schoolId/collection')
export class CollectionController {
  constructor(private readonly access:Access,private readonly collection:CollectionService){}
  @Get('learners')
  roster(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Query() page:CollectionRosterDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.collection.roster(client,actor,page));}
  @Get('learners/:id')
  detail(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Query() page:PageDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.collection.detail(client,actor,id,page));}
  @Post('learners/:id/release')
  release(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:CollectionReleaseDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.collection.release(client,actor,id,body),true);}
  @Post('learners/:id/cases')
  createCase(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:CollectionCaseDto){return this.access.school(req,schoolId,staff,(client,actor)=>this.collection.createCase(client,actor,id,body),true);}
  @Post('cases/:id/review')
  review(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:CollectionReviewDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.collection.review(client,actor,id,body),true);}
  @Post('events/:id/void')
  void(@Req() req:Request,@Param('schoolId',new ParseUUIDPipe()) schoolId:string,@Param('id',new ParseUUIDPipe()) id:string,@Body() body:CollectionVoidDto){return this.access.school(req,schoolId,['headteacher'],(client,actor)=>this.collection.void(client,actor,id,body),true);}
}
