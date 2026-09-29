import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { Access } from '../../core/access';
import { OperationDto } from '../learners/learners.dto';
import { AiService } from './ai.service';

class SettingsDto extends OperationDto {
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(1) @Max(5000) monthlyRunCap!: number;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(500) acknowledgement?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
}
class DraftDto {
  @IsUUID() learnerId!: string;
  @IsUUID() enrolmentId!: string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) periodStart!: string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) periodEnd!: string;
}
class FeedbackDto { @IsIn(['accepted','edited','discarded']) outcome!: string; }

@Controller('api/v1/schools/:schoolId/ai')
export class AiController {
  constructor(private readonly access: Access, private readonly ai: AiService) {}
  @Get('settings')
  settings(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string) {
    return this.access.school(req,schoolId,['headteacher','teacher'],client => this.ai.settings(client,schoolId));
  }
  @Put('settings')
  save(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: SettingsDto) {
    return this.access.school(req,schoolId,['headteacher'],(client,actor) => this.ai.saveSettings(client,actor,body),true);
  }
  @Post('early-years/report-draft')
  async draft(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Body() body: DraftDto) {
    const prepared = await this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.ai.prepare(client,actor,body),true);
    const done = await this.ai.complete(prepared);
    return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.ai.record(client,actor,body,prepared,done),true);
  }
  @Post('runs/:runId/feedback')
  feedback(@Req() req: Request,@Param('schoolId',new ParseUUIDPipe()) schoolId: string,@Param('runId',new ParseUUIDPipe()) runId: string,@Body() body: FeedbackDto) {
    return this.access.school(req,schoolId,['headteacher','teacher'],(client,actor) => this.ai.feedback(client,actor,runId,body.outcome),true);
  }
}
