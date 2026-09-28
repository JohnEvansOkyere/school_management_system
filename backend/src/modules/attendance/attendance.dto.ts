import { IsArray,IsBoolean,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,MaxLength,Min,MinLength,ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { OperationDto,PageDto } from '../learners/learners.dto';
export class SchoolDayDto extends OperationDto {
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) day!:string;
  @IsBoolean() isOpen!:boolean;
  @IsString() @MinLength(3) @MaxLength(300) @Matches(/\S.{1,}\S/) reason!:string;
  @IsOptional() @IsInt() @Min(1) version?:number;
}
export class MarkDto {
  @IsUUID() learnerId!:string;
  @IsIn(['unmarked','present','late','absent','excused']) mark!:string;
}
export class RegisterDto extends OperationDto {
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) day!:string;
  @IsInt() @Min(0) version=0;
  @IsIn(['save','submit','lock','correct']) action!:string;
  @IsArray() @ValidateNested({each:true}) @Type(()=>MarkDto) marks!:MarkDto[];
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) correctionReason?:string;
}
export class AttendancePageDto extends PageDto {
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) day!:string;
}
