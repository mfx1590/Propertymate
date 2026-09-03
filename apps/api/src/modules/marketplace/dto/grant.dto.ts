import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RecordPaymentDto } from '../../payments/dto/payments.dto';

export class GrantSubscriptionDto {
  /** Email or phone — admins identify a user by whichever they were given. */
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsString()
  @IsNotEmpty()
  planKey: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  months?: number;

  /**
   * What was collected for this period, if anything. Omitted means a waived
   * grant, which is how every subscription on the platform was created before
   * this existed.
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RecordPaymentDto)
  payment?: RecordPaymentDto;
}
