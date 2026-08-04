import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel } from '@propverify/shared';
import type { ChannelProvider, DeliveryContext, DeliveryResult } from './channel.provider';

const GRAPH_VERSION = 'v21.0';

/**
 * WhatsApp via the Meta Cloud API (Plan §6.6).
 *
 * Business-initiated messages outside a 24-hour customer service window must
 * use a pre-approved template, so this provider never sends free text: a key
 * without a `whatsappTemplate` in the registry is skipped rather than
 * downgraded to a text message Meta would reject anyway.
 *
 * Language is the recipient's locale — templates are approved per language, so
 * the code sent here has to match one Meta has on file.
 */
@Injectable()
export class WhatsAppProvider implements ChannelProvider {
  readonly channel: NotificationChannel = 'whatsapp';
  private readonly logger = new Logger('WhatsAppChannel');

  constructor(private readonly config: ConfigService) {}

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    if (!ctx.recipient.phone) return { status: 'skipped', reason: 'no phone number on file' };
    if (!ctx.whatsapp) {
      return { status: 'skipped', reason: `no approved template for ${ctx.templateKey}` };
    }

    const token = this.config.get<string>('WHATSAPP_TOKEN');
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    if (!token || !phoneNumberId) {
      this.logger.debug(`[dev] whatsapp to ${ctx.recipient.phone}: ${ctx.whatsapp.template}`);
      return { status: 'skipped', reason: 'WHATSAPP_TOKEN/PHONE_NUMBER_ID not configured' };
    }

    // Meta wants the number without a leading +
    const to = ctx.recipient.phone.replace(/^\+/, '');
    try {
      const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: ctx.whatsapp.template,
            language: { code: ctx.locale },
            ...(ctx.whatsapp.params.length
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: ctx.whatsapp.params.map((text) => ({ type: 'text', text })),
                    },
                  ],
                }
              : {}),
          },
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        return {
          status: 'failed',
          error: `whatsapp ${res.status}: ${detail}`,
          retryable: res.status >= 500 || res.status === 429,
        };
      }
      const json = (await res.json()) as { messages?: { id: string }[] };
      return { status: 'sent', reference: json.messages?.[0]?.id };
    } catch (err) {
      return { status: 'failed', error: String(err), retryable: true };
    }
  }
}
