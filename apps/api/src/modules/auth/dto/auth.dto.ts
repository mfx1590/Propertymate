import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length, MinLength } from 'class-validator';
import { LOCALES } from '@propverify/shared';

/**
 * Account type is chosen once, at registration (change log 2026-07-10).
 * customer is the baseline everyone gets; admin is never self-selectable.
 */
export const ACCOUNT_TYPES = ['customer', 'owner', 'solo_agent', 'agency', 'developer'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export class RequestOtpDto {
  @IsPhoneNumber(undefined, { message: 'phone must be in international format, e.g. +905331234567' })
  phone: string;
}

export class VerifyOtpDto {
  @IsPhoneNumber(undefined, { message: 'phone must be in international format, e.g. +905331234567' })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  /** applied only when this verify creates a new account */
  @IsOptional()
  @IsIn(ACCOUNT_TYPES as unknown as string[])
  accountType?: AccountType;

  /** invite code the signup arrived on (Plan §8); ignored for existing accounts */
  @IsOptional()
  @IsString()
  @Length(4, 16)
  referralCode?: string;
}

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsIn(LOCALES as unknown as string[])
  locale?: string;

  @IsOptional()
  @IsIn(ACCOUNT_TYPES as unknown as string[])
  accountType?: AccountType;

  /** invite code the signup arrived on (Plan §8) */
  @IsOptional()
  @IsString()
  @Length(4, 16)
  referralCode?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
