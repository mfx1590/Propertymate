import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, Length, MinLength } from 'class-validator';
import { LOCALES } from '@propverify/shared';

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
