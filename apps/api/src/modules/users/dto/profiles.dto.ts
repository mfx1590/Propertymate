import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Roles a user can apply for. customer is automatic; admin is granted by admins only. */
export const APPLICABLE_ROLE_KEYS = ['owner', 'solo_agent', 'agency', 'developer'] as const;
export type ApplicableRoleKey = (typeof APPLICABLE_ROLE_KEYS)[number];

export class ApplyRoleDto {
  @IsIn(APPLICABLE_ROLE_KEYS as unknown as string[])
  roleKey: ApplicableRoleKey;
}

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
