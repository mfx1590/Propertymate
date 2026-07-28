import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CURRENCIES } from '@propverify/shared';

/** One structured payment plan (§6.3: down %, installments, delivery-linked). */
export class PaymentPlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  downPaymentPct: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  installments: number;

  @IsOptional()
  @IsIn(['monthly', 'quarterly'])
  installmentFrequency?: 'monthly' | 'quarterly';

  /** Percentage held back until handover. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  onDeliveryPct?: number;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  regionSlug?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsDateString()
  deliveryDate?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentPlanDto)
  paymentPlans?: PaymentPlanDto[];
}

export class UnitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  unitNo: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  areaM2?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-5)
  @Max(200)
  floor?: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  priceAmount: number;

  @IsIn(CURRENCIES as unknown as string[])
  priceCurrency: string;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  areaM2?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-5)
  @Max(200)
  floor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  priceAmount?: number;

  @IsOptional()
  @IsIn(CURRENCIES as unknown as string[])
  priceCurrency?: string;

  /** Developers may hold or release a unit by hand; `sold` is set by deal completion. */
  @IsOptional()
  @IsIn(['available', 'reserved'])
  status?: 'available' | 'reserved';
}

export class PublishUpdateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(8000)
  body: string;

  @IsOptional()
  @IsString({ each: true })
  mediaUrls?: string[];
}

export class ProjectInquiryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
