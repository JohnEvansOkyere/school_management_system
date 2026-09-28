import { IsDateString,IsInt,IsString,IsUUID,Matches,MaxLength,Min,MinLength } from 'class-validator';
import { OperationDto,PageDto } from '../learners/learners.dto';
export class RosterQueryDto extends PageDto {
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!:string;
}
export class TeachingAssignmentDto extends OperationDto {
  @IsUUID() classId!:string;
  @IsUUID() teacherMembershipId!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!:string;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) reason!:string;
}
export class RevokeTeachingDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) reason!:string;
}
