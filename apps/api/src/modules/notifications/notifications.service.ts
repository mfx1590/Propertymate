import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_CHANNELS,
  MANDATORY_CHANNELS,
  NOTIFICATION_CATEGORIES,
  categoryOf,
  channelsFor,
  type NotificationCategory,
  type NotificationChannel,
} from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { renderTemplate } from './templates';

/**
 * Fan-out across channels (Plan §6.6).
 *
 * Call sites still pass nothing but a template key: which channels a key uses
 * is policy in `@propverify/shared`, filtered by the user's preferences. The
 * in-app row is written synchronously so the bell updates immediately; the
 * external channels are queued, because a Meta or Resend timeout must not be
 * on the critical path of accepting an offer.
 *
 * The queue is addressed via an event rather than an injected BullMQ queue:
 * this module is `@Global` and imported by nearly everything, so depending on
 * the jobs module here would make an import cycle out of the whole graph.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async notify(userId: string, templateKey: string, payload?: Record<string, unknown>) {
    const channels = await this.channelsForUser(userId, templateKey);
    const data = payload as Prisma.InputJsonValue | undefined;

    for (const channel of channels) {
      const row = await this.prisma.notification.create({
        data: {
          userId,
          channel,
          templateKey,
          payload: data,
          // in-app IS the row; everything else is sent by the worker
          sentAt: channel === 'in_app' ? new Date() : null,
        },
      });

      if (channel === 'in_app') {
        // the chat gateway relays this to the user's socket room
        this.events.emit('chat.notify', {
          userId,
          event: 'notification',
          data: { id: row.id, templateKey, payload },
        });
      } else {
        this.events.emit('notification.queued', { notificationId: row.id, channel });
      }
    }
  }

  /** Preference-filtered channel list for this user + template. */
  private async channelsForUser(
    userId: string,
    templateKey: string,
  ): Promise<NotificationChannel[]> {
    const category = categoryOf(templateKey);
    if (!category) return ['in_app'];

    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_category: { userId, category } },
      select: { channels: true },
    });
    return channelsFor(templateKey, pref ? (pref.channels as NotificationChannel[]) : null);
  }

  async listFor(userId: string, limit = 20) {
    // the bell shows the in-app record; email/push rows are delivery bookkeeping
    return this.prisma.notification.findMany({
      where: { userId, channel: 'in_app' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Per-channel delivery log for the caller — answers "was I actually emailed?"
   * without an admin having to read the table.
   */
  async deliveriesFor(userId: string, limit = 50) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        channel: true,
        templateKey: true,
        sentAt: true,
        failedAt: true,
        error: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      status: r.sentAt ? 'sent' : r.error?.startsWith('skipped:') ? 'skipped' : r.failedAt ? 'failed' : 'queued',
    }));
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  /** Effective preferences: stored rows layered over the platform defaults. */
  async preferencesFor(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({ where: { userId } });
    const stored = new Map(rows.map((r) => [r.category, r.channels as NotificationChannel[]]));
    return {
      mandatory: MANDATORY_CHANNELS,
      categories: NOTIFICATION_CATEGORIES.map((category) => ({
        category,
        channels: stored.get(category) ?? DEFAULT_CHANNELS[category],
        isDefault: !stored.has(category),
      })),
    };
  }

  async setPreference(userId: string, category: NotificationCategory, channels: NotificationChannel[]) {
    // in_app cannot be switched off — it is the record of what happened, and
    // dropping it would leave the user's own history with holes in it
    const merged = [...new Set([...MANDATORY_CHANNELS, ...channels])];
    await this.prisma.notificationPreference.upsert({
      where: { userId_category: { userId, category } },
      update: { channels: merged },
      create: { userId, category, channels: merged },
    });
    return this.preferencesFor(userId);
  }

  /** Back to platform defaults — deletes the row rather than copying defaults in. */
  async resetPreference(userId: string, category: NotificationCategory) {
    await this.prisma.notificationPreference.deleteMany({ where: { userId, category } });
    return this.preferencesFor(userId);
  }

  async registerPushToken(userId: string, token: string, platform?: string) {
    // a device can change hands between accounts; the token follows the device
    const row = await this.prisma.pushToken.upsert({
      where: { token },
      update: { userId, lastSeenAt: new Date(), ...(platform ? { platform } : {}) },
      create: { userId, token, platform: platform ?? 'unknown' },
    });
    return { id: row.id, token: row.token, platform: row.platform };
  }

  async removePushToken(userId: string, token: string) {
    const { count } = await this.prisma.pushToken.deleteMany({ where: { userId, token } });
    return { removed: count };
  }

  /** Preview of the server-rendered copy — used by the preferences UI. */
  preview(templateKey: string, locale: string, payload: Record<string, unknown> = {}) {
    const { title, body } = renderTemplate(templateKey, locale, payload);
    return { templateKey, title, body };
  }
}
