import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { MockOtpProvider, OTP_PROVIDER, TwilioOtpProvider } from './otp/otp.provider';

@Module({
  imports: [
    // global so the APP_GUARD JwtAuthGuard can inject JwtService anywhere
    JwtModule.register({ global: true }),
    UsersModule, // ProfilesService assigns the account type chosen at registration
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    MockOtpProvider,
    TwilioOtpProvider,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService, MockOtpProvider, TwilioOtpProvider],
      useFactory: (config: ConfigService, mock: MockOtpProvider, twilio: TwilioOtpProvider) =>
        (config.get<string>('OTP_PROVIDER') ?? 'mock') === 'twilio' ? twilio : mock,
    },
  ],
  exports: [TokenService],
})
export class AuthModule {}
