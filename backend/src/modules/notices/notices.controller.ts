import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Access } from '../../core/access';
import { NoticesService } from './notices.service';
import { ApproveNoticeDto, CancelNoticeDto, NoticeDto, RetryDto } from './notices.dto';

const head = ['headteacher'];
@Controller('api/v1/schools/:schoolId')
export class NoticesController {
  constructor(private readonly access: Access, private readonly notices: NoticesService) {}
  @Get('notices')
  list(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,head,async client => ({items:await this.notices.list(client,schoolId)}));
  }
  @Post('notices')
  create(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: NoticeDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.notices.create(client,actor,body),true);
  }
  @Post('notices/:noticeId/approve')
  approve(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('noticeId',new ParseUUIDPipe()) id: string,@Body() body: ApproveNoticeDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.notices.approve(client,actor,id,body),true);
  }
  @Post('notices/:noticeId/cancel')
  cancel(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('noticeId',new ParseUUIDPipe()) id: string,@Body() body: CancelNoticeDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.notices.cancel(client,actor,id,body),true);
  }
  @Post('notices/:noticeId/retry-failed')
  retry(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('noticeId',new ParseUUIDPipe()) id: string,@Body() body: RetryDto) {
    return this.access.school(req,schoolId,head,(client,actor) => this.notices.retry(client,actor,id,body),true);
  }
  @Get('notices/:noticeId/deliveries')
  deliveries(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('noticeId',new ParseUUIDPipe()) id: string) {
    return this.access.school(req,schoolId,head,async client => ({items:await this.notices.deliveries(client,schoolId,id)}));
  }
  @Get('guardian/notices')
  mine(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,['guardian'],async (client,actor) => ({items:await this.notices.mine(client,actor)}));
  }
}
