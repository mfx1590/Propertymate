import { IsArray, IsIn, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MaxLength } from 'class-validator';

export class AddMemberDto {
  @IsPhoneNumber(undefined, { message: 'phone must be in international format, e.g. +905331234567' })
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regions?: string[];

  @IsOptional()
  @IsIn(['org_admin', 'member'])
  orgRole?: 'org_admin' | 'member';
}

export class UpdateMemberDto {
  @IsOptional()
  @IsIn(['org_admin', 'member'])
  orgRole?: 'org_admin' | 'member';

  @IsOptional()
  @IsIn(['active', 'deactivated'])
  status?: 'active' | 'deactivated';
}

export class AgencyIdParam {
  @IsString()
  @IsNotEmpty()
  id: string;
}
