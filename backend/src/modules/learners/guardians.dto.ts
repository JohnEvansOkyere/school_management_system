import { IsBoolean,IsInt,IsString,IsUUID,Matches,MaxLength,Min,MinLength } from 'class-validator';
import { OperationDto } from './learners.dto';
export class GuardianLinkDto extends OperationDto {
  @IsUUID() learnerId!:string;
  @IsUUID() guardianMembershipId!:string;
  @IsBoolean() academic!:boolean;
  @IsBoolean() billing!:boolean;
  @IsBoolean() pickup!:boolean;
  @IsBoolean() contact!:boolean;
}
export class GuardianReviewDto extends OperationDto {
  @IsInt() @Min(1) version!:number;
  @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.{1,}\S/) reason!:string;
}
