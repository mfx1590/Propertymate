import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * In-app channel live now; push/WhatsApp/email senders plug into the same
 * template registry later (Plan §6.6). templateKey examples:
 * verification.approved, verification.rejected, availability.confirm_needed.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: string, templateKey: string, payload?: Record<string, unknown>) {
    await this.prisma.notification.create({
      data: {
        userId,
        channel: 'in_app',
        templateKey,
        payload: payload as Prisma.InputJsonValue | undefined,
        sentAt: new Date(),
      },
    });
  }

  async listFor(userId: string, limit = 20) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
