import { Injectable, Logger } from '@nestjs/common';

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');

/**
 * Provider abstraction so dev uses a mock and production swaps in Twilio
 * without touching auth logic (Plan §10 Phase 1: "OTP mock in dev,
 * Twilio-ready interface").
 */
export interface OtpProvider {
  send(phone: string, code: string): Promise<void>;
}

@Injectable()
export class MockOtpProvider implements OtpProvider {
  private readonly logger = new Logger('MockOtp');

  async send(phone: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${phone}: ${code}`);
  }
}

/** Wire real Twilio Verify here in production (TWILIO_* env vars are already in .env.example). */
@Injectable()
export class TwilioOtpProvider implements OtpProvider {
  async send(_phone: string, _code: string): Promise<void> {
    throw new Error('TwilioOtpProvider not implemented yet — set OTP_PROVIDER=mock');
  }
}
