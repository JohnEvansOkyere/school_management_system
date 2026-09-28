import { IsDateString,IsInt,IsOptional,IsString,IsUUID,Matches,MaxLength,Min,MinLength } from 'class-validator';
import { OperationDto,PageDto } from '../learners/learners.dto';

export class EarlyYearsReportCreateDto extends OperationDto {
  @IsUUID() learnerId!:string;
  @IsUUID() enrolmentId!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) periodStart!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) periodEnd!:string;
  @IsString() @MinLength(3) @MaxLength(2000) strengths!:string;
  @IsString() @MinLength(3) @MaxLength(2000) nextSteps!:string;
  @IsOptional() @IsString() @MaxLength(2000) teacherNote?:string;
}
export class EarlyYearsReportEditDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsString() @MinLength(3) @MaxLength(2000) strengths!:string;
  @IsString() @MinLength(3) @MaxLength(2000) nextSteps!:string;
  @IsOptional() @IsString() @MaxLength(2000) teacherNote?:string;
}
export class EarlyYearsReportRevisionDto extends EarlyYearsReportEditDto {
  @IsString() @MinLength(3) @MaxLength(500) correctionReason!:string;
}
export class EarlyYearsReportTransitionDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?:string;
}
export class EarlyYearsReportListDto extends PageDto {
  @IsOptional() @IsUUID() classId?:string;
  @IsOptional() @IsUUID() learnerId?:string;
  @IsOptional() @IsString() @MaxLength(20) status?:string;
}
