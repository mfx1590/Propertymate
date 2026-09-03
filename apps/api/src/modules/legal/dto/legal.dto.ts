import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RequestQuotesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  lawyerUserIds: string[];

  /** What the client wants done — free text, shown to every lawyer asked. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scope?: string;
}

/**
 * Quote currencies are the ones the platform already knows how to display
 * (§6.1 multi-currency). A quote is a real figure someone will be invoiced for,
 * so it is never converted for display — the same rule the deal snapshot and
 * commission figures follow.
 */
export const QUOTE_CURRENCIES = ['GBP', 'EUR', 'USD', 'TRY'] as const;

export class QuoteDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  // A legal fee above this is a data-entry slip, not a quote.
  @Max(1_000_000)
  amount: number;

  @IsIn(QUOTE_CURRENCIES as unknown as string[])
  currency: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
