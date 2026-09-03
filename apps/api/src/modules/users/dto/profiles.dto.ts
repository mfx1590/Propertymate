import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Grantable non-customer roles. customer is automatic; admin is granted by admins only. */
export const APPLICABLE_ROLE_KEYS = ['owner', 'solo_agent', 'agency', 'developer', 'lawyer'] as const;
export type ApplicableRoleKey = (typeof APPLICABLE_ROLE_KEYS)[number];

export class UpdateAgentProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  licenseNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  regions?: string[];
}

export class UpdateAgencyProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  regNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string;
}

export class UpdateDeveloperProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  regNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  taxNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string;
}

/**
 * A lawyer is picked on what they cover and what they charge, so those are the
 * only fields here. `feeModel` is indicative — the binding number is the quote
 * on a specific deal, and the profile says so rather than implying a price.
 */
export const LAWYER_FEE_MODELS = ['fixed', 'hourly', 'percentage'] as const;

export class UpdateLawyerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  firmName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  barNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  regions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsIn(LAWYER_FEE_MODELS as unknown as string[])
  feeModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  feeNote?: string;
}
