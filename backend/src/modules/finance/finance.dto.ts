import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { OperationDto, PageDto } from '../learners/learners.dto';

const ymd = () => Matches(/^\d{4}-\d{2}-\d{2}$/);
const money = { max: 100000000000 };
export class FeeItemDto extends OperationDto {
  @IsUUID() termId!: string;
  @IsString() @MinLength(2) @MaxLength(80) @Matches(/\S.*\S/) name!: string;
  @IsOptional() @IsIn(['Nursery','KG','Primary','JHS']) level?: string;
  @IsInt() @Min(1) @Max(money.max) amountPesewas!: number;
}
export class GenerateInvoicesDto extends OperationDto { @IsUUID() termId!: string; @IsUUID() classId!: string; }
export class PaymentDto extends OperationDto {
  @IsUUID() invoiceId!: string;
  @IsInt() @Min(1) @Max(money.max) amountPesewas!: number;
  @IsIn(['cash','mobile_money','bank']) method!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) reference?: string;
  @IsDateString({strict:true}) @ymd() receivedOn!: string;
}
export class ReverseDto extends OperationDto { @IsString() @MinLength(3) @MaxLength(500) @Matches(/\S.*\S/) reason!: string; }
export class InvoiceQueryDto extends PageDto {
  @IsUUID() termId!: string;
  @IsOptional() @IsUUID() classId?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() outstandingOnly?: boolean;
}
export class SummaryQueryDto { @IsUUID() termId!: string; }
