import { Type } from 'class-transformer';
import { ArrayMaxSize,ArrayMinSize,IsArray,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,MaxLength,Min,MinLength,ValidateNested } from 'class-validator';
import { OperationDto,PageDto } from '../learners/learners.dto';
export class EarlyYearsClassesDto extends PageDto {
  @IsIn(['Nursery','KG']) level!:string;
}
export class IndicatorDescriptorDto {
  @IsUUID() id!:string;
  @IsString() @MinLength(3) @MaxLength(240) text!:string;
}
export class EarlyYearsIndicatorDto {
  @IsString() @MinLength(1) @MaxLength(40) code!:string;
  @IsString() @MinLength(3) @MaxLength(160) title!:string;
  @IsString() @MinLength(2) @MaxLength(120) learningArea!:string;
  @IsString() @MinLength(2) @MaxLength(160) strand!:string;
  @IsString() @MinLength(2) @MaxLength(160) subStrand!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({each:true}) @Type(()=>IndicatorDescriptorDto) descriptors!:IndicatorDescriptorDto[];
}
export class EarlyYearsPolicyDto extends OperationDto {
  @IsIn(['Nursery','KG']) level!:string;
  @IsString() @MinLength(3) @MaxLength(120) title!:string;
  @IsIn(['school_local','official_reference_supplied_by_school']) sourceKind!:string;
  @IsString() @MinLength(3) @MaxLength(120) sourceIssuer!:string;
  @IsString() @MinLength(3) @MaxLength(500) sourceReference!:string;
  @IsString() @MinLength(1) @MaxLength(80) sourceVersion!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveStart!:string;
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveEnd?:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) specialistName?:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) specialistQualification?:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) specialistReviewReference?:string;
  @IsOptional() @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) specialistReviewedOn?:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({each:true}) @Type(()=>EarlyYearsIndicatorDto) indicators!:EarlyYearsIndicatorDto[];
}
export class PolicyTransitionDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) reason?:string;
}
export class ObservationEntryDto {
  @IsUUID() indicatorId!:string;
  @IsIn(['observed','not_observed']) status!:string;
  @IsOptional() @IsUUID() descriptorId?:string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) evidence?:string;
}
export class EarlyYearsObservationDto extends OperationDto {
  @IsUUID() learnerId!:string;
  @IsUUID() enrolmentId!:string;
  @IsDateString({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}$/) observedOn!:string;
  @IsUUID() policyId!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({each:true}) @Type(()=>ObservationEntryDto) entries!:ObservationEntryDto[];
}
export class ObservationHistoryDto extends PageDto {
  @IsOptional() @IsUUID() learnerId?:string;
  @IsOptional() @IsUUID() classId?:string;
}
export class CorrectObservationDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsString() @MinLength(3) @MaxLength(500) correctionReason!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({each:true}) @Type(()=>ObservationEntryDto) entries!:ObservationEntryDto[];
}
