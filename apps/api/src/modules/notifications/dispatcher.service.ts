import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { ChannelProvider } from './channels/channel.provider';
import { EmailProvider } from './channels/email.provider';
import { PushProvider } from './channels/push.provider';
import { WhatsAppProvider } from './channels/whatsapp.provider';
import { renderTemplate } from './templates';

/**
 * Delivers ONE queued (notification row, channel) pair.
 *
 * Runs on the BullMQ worker rather than in the request: an outbound HTTP call
 * to Resend or Meta must never sit between a user accepting an offer and their
 * response, and a provider outage must not roll back the domain action that
 * caused the notification.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);
  private readonly providers: Map<NotificationChannel, ChannelProvider>;

  constructor(
    private readonly prisma: PrismaService,
    email: EmailProvider,
    push: PushProvider,
    whatsapp: WhatsAppProvider,
  ) {
    this.providers = new Map<NotificationChannel, ChannelProvider>(
      [email, push, whatsapp].map((p) => [p.channel, p]),
    );
  }

  /**
   * @returns whether the job should be retried by the queue.
   * A skipped delivery is a terminal, expected outcome — an owner with no
   * email address is not an error to retry until the queue gives up.
   */
  async deliver(notificationId: string): Promise<{ retry: boolean; status: string }> {
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: { select: { email: true, phone: true, locale: true } } },
    });
    if (!row) return { retry: false, status: 'gone' };
    if (row.sentAt) return { retry: false, status: 'already-sent' };

    const provider = this.providers.get(row.channel as NotificationChannel);
    if (!provider) {
      await this.fail(notificationId, `no provider for channel ${row.channel}`);
      return { retry: false, status: 'no-provider' };
    }

    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const locale = row.user.locale ?? 'en';
    const { title, body, def } = renderTemplate(row.templateKey, locale, payload);

    const result = await provider.send({
      userId: row.userId,
      templateKey: row.templateKey,
      payload,
      title,
      body,
      locale,
      recipient: { email: row.user.email, phone: row.user.phone },
      ...(def?.whatsappTemplate
        ? {
            whatsapp: {
              template: def.whatsappTemplate,
              params: (def.whatsappParams ?? []).map((k) => String(payload[k] ?? '')),
            },
          }
        : {}),
    });

    if (result.status === 'sent') {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { sentAt: new Date(), error: null, failedAt: null },
      });
      return { retry: false, status: 'sent' };
    }

    if (result.status === 'skipped') {
      // recorded, not retried: the row is the evidence of why nothing was sent
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { failedAt: new Date(), error: `skipped: ${result.reason}` },
      });
      return { retry: false, status: 'skipped' };
    }

    await this.fail(notificationId, result.error);
    this.logger.warn(`${row.channel} delivery failed for ${notificationId}: ${result.error}`);
    return { retry: result.retryable, status: 'failed' };
  }

  private async fail(id: string, error: string) {
    await this.prisma.notification.update({
      where: { id },
      data: { failedAt: new Date(), error: error.slice(0, 500) },
    });
  }
}
