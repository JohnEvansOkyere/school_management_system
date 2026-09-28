import { IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,MaxLength,Min,MinLength } from 'class-validator';
import { OperationDto,PageDto } from './learners.dto';
export class CollectionRosterDto extends PageDto { @IsOptional() @IsIn(['true']) history?:'true'; }
class LearnerCommandDto extends OperationDto { @IsInt() @Min(1) learnerVersion!:number; }
export class CollectionCaseDto extends LearnerCommandDto {
  @IsString() @MinLength(3) @MaxLength(120) @Matches(/^[^\x00-\x1f\x7f]+$/) @Matches(/\S.{1,}\S/) collectorName!:string;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/^[^\x00]*$/) @Matches(/\S.{1,}\S/) reason!:string;
}
export class CollectionReleaseDto extends LearnerCommandDto {
  @IsOptional() @IsUUID() guardianLinkId?:string;
  @IsOptional() @IsInt() @Min(1) guardianLinkVersion?:number;
  @IsOptional() @IsUUID() exceptionId?:string;
  @IsOptional() @IsInt() @Min(1) exceptionVersion?:number;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/^[^\x00]*$/) @Matches(/\S.{1,}\S/) verificationReason!:string;
}
export class CollectionReviewDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsIn(['approve','decline','cancel']) action!:'approve'|'decline'|'cancel';
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/^[^\x00]*$/) @Matches(/\S.{1,}\S/) reason!:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/^[^\x00]*$/) @Matches(/\S.{1,}\S/) verificationReason?:string;
}
export class CollectionVoidDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/^[^\x00]*$/) @Matches(/\S.{1,}\S/) reason!:string;
}
