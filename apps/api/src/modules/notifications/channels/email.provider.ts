import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel } from '@propverify/shared';
import type { ChannelProvider, DeliveryContext, DeliveryResult } from './channel.provider';

/**
 * Email via Resend's HTTP API (Plan §2.1 "Resend/SES").
 *
 * Called over plain fetch rather than the SDK: one POST with an API key is the
 * whole integration, and swapping to SES later means changing this file only.
 *
 * With no `RESEND_API_KEY` the provider logs and reports `skipped`, so dev and
 * CI run the full multi-channel path without credentials and without pretending
 * mail was delivered.
 */
@Injectable()
export class EmailProvider implements ChannelProvider {
  readonly channel: NotificationChannel = 'email';
  private readonly logger = new Logger('EmailChannel');

  constructor(private readonly config: ConfigService) {}

  private get apiKey() {
    return this.config.get<string>('RESEND_API_KEY');
  }

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    if (!ctx.recipient.email) return { status: 'skipped', reason: 'no email address on file' };
    if (!this.apiKey) {
      this.logger.debug(`[dev] email to ${ctx.recipient.email}: ${ctx.title}`);
      return { status: 'skipped', reason: 'RESEND_API_KEY not configured' };
    }

    const from = this.config.get<string>('EMAIL_FROM') ?? 'PropVerify <noreply@propverify.local>';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [ctx.recipient.email],
          subject: ctx.title,
          text: ctx.body,
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        return {
          status: 'failed',
          error: `resend ${res.status}: ${detail}`,
          // 4xx is our payload being wrong; retrying it just burns the queue
          retryable: res.status >= 500 || res.status === 429,
        };
      }
      const json = (await res.json()) as { id?: string };
      return { status: 'sent', reference: json.id };
    } catch (err) {
      return { status: 'failed', error: String(err), retryable: true };
    }
  }
}
