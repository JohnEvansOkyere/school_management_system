import { ArrayMaxSize,ArrayMinSize,IsArray,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength,ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { OperationDto } from './learners.dto';
export class StageImportDto extends OperationDto {
  @IsString() @MinLength(1) @MaxLength(160) @Matches(/\S/) @Matches(/^[^\x00-\x1f\x7f]+$/) sourceName!:string;
  @IsUUID() classId!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!:string;
  @IsOptional() @IsIn(['iso','dmy','mdy']) dateFormat?:'iso'|'dmy'|'mdy';
  @IsString() @MinLength(1) @MaxLength(40000) @Matches(/^[^\x00]*$/) csv!:string;
}
export class ValidateImportDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
}
export class ImportSelectionDto {
  @IsInt() @Min(2) @Max(201) rowNumber!:number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) duplicateReviewReason?:string;
}
export class CommitImportDto extends ValidateImportDto {
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) approvalReason!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>ImportSelectionDto) selectedRows!:ImportSelectionDto[];
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) capacityOverrideReason?:string;
}
