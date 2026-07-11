import {
  IsBoolean,
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
} from 'class-validator';
import { Type } from 'class-transformer';
import { CURRENCIES } from '@propverify/shared';

const KINDS = ['resale', 'rental'] as const;
const DEED_TYPES = ['turkish', 'exchange', 'allocation', 'foreign', 'na'] as const;

export class CreatePropertyDto {
  @IsIn(KINDS as unknown as string[])
  kind: 'resale' | 'rental';
}

export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsString()
  regionSlug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  priceAmount?: number;

  @IsOptional()
  @IsIn(CURRENCIES as unknown as string[])
  priceCurrency?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  bathrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  areaM2?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  plotM2?: number;

  @IsOptional()
  @IsIn(DEED_TYPES as unknown as string[])
  deedType?: string;

  @IsOptional()
  @IsBoolean()
  furnished?: boolean;

  @IsOptional()
  @IsString({ each: true })
  features?: string[];
}

export class ReorderMediaDto {
  @IsString({ each: true })
  mediaIds: string[];
}

export class CreateSavedSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsNotEmpty()
  query: Record<string, unknown>;

  @IsOptional()
  @IsIn(['push', 'email', 'whatsapp'])
  alertChannel?: 'push' | 'email' | 'whatsapp';
}
