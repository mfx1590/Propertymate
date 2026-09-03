import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** The currencies the platform already knows how to display (§6.1). */
export const PLAN_CURRENCIES = ['GBP', 'EUR', 'USD', 'TRY'] as const;
export const PLAN_INTERVALS = ['month', 'year'] as const;

export class SetPlanPriceDto {
  /**
   * `null` clears the price. Distinguished from an absent field on purpose: a
   * plan being repriced should be able to say "not priced" rather than keep
   * quoting a figure nobody stands behind.
   */
  @IsOptional()
  @ValidateIf((o) => o.priceAmount !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  // A subscription above this is a data-entry slip, not a plan.
  @Max(1_000_000)
  priceAmount?: number | null;

  @IsOptional()
  @IsIn(PLAN_CURRENCIES as unknown as string[])
  currency?: string;

  @IsOptional()
  @IsIn(PLAN_INTERVALS as unknown as string[])
  interval?: string;
}

/**
 * What an admin says happened offline. Absent means nothing was collected,
 * which is recorded as a waived grant rather than as silence.
 */
export class RecordPaymentDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  amount?: number;

  /** A bank reference, receipt number, or whatever ties this to the money. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** When the money moved, if that is not today. */
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}
