import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@propverify/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ChannelProvider, DeliveryContext, DeliveryResult } from './channel.provider';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Push via Expo (Plan §2.1 "React Native (Expo)", §6.6 "push (FCM via Expo)").
 *
 * Expo's push service needs no credentials for the free tier, so this is the
 * one external channel that works end-to-end the moment the mobile app ships —
 * nothing to configure, only tokens to register.
 *
 * Tokens Expo reports as dead are deleted here: a device that uninstalled the
 * app would otherwise generate a failure on every future send forever.
 */
@Injectable()
export class PushProvider implements ChannelProvider {
  readonly channel: NotificationChannel = 'push';
  private readonly logger = new Logger('PushChannel');

  constructor(private readonly prisma: PrismaService) {}

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    const tokens = await this.prisma.pushToken.findMany({
      where: { userId: ctx.userId },
      select: { token: true },
    });
    if (tokens.length === 0) return { status: 'skipped', reason: 'no registered devices' };

    const messages = tokens.map((t) => ({
      to: t.token,
      title: ctx.title,
      body: ctx.body,
      data: { templateKey: ctx.templateKey, ...ctx.payload },
      sound: 'default',
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        return {
          status: 'failed',
          error: `expo ${res.status}: ${(await res.text()).slice(0, 300)}`,
          retryable: res.status >= 500 || res.status === 429,
        };
      }

      const json = (await res.json()) as {
        data?: { status: string; message?: string; details?: { error?: string } }[];
      };
      const tickets = json.data ?? [];

      const dead = tickets
        .map((ticket, i) => ({ ticket, token: tokens[i]?.token }))
        .filter(({ ticket }) => ticket.details?.error === 'DeviceNotRegistered')
        .map(({ token }) => token)
        .filter((t): t is string => Boolean(t));
      if (dead.length) {
        await this.prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
        this.logger.log(`Pruned ${dead.length} unregistered push token(s)`);
      }

      const delivered = tickets.filter((t) => t.status === 'ok').length;
      if (delivered === 0) {
        const reason = tickets[0]?.message ?? 'no device accepted the message';
        return dead.length === tickets.length
          ? { status: 'skipped', reason: 'all devices unregistered' }
          : { status: 'failed', error: reason, retryable: false };
      }
      return { status: 'sent', reference: `${delivered}/${tickets.length} devices` };
    } catch (err) {
      return { status: 'failed', error: String(err), retryable: true };
    }
  }
}
