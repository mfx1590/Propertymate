import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AVAILABILITY_CONFIRM_DAYS } from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const DAY_MS = 86_400_000;

/**
 * 90-day freshness rule (Plan §4): nudge at day 83 and 88, auto-pause at 90.
 * Runs as a daily cron; moves to a BullMQ repeatable job in the hardening
 * pass so it survives multi-instance deployments.
 */
@Injectable()
export class FreshnessService {
  private readonly logger = new Logger(FreshnessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async run() {
    const now = Date.now();
    const live = await this.prisma.property.findMany({
      where: { status: 'live', deletedAt: null, availabilityConfirmedAt: { not: null } },
      select: { id: true, createdByUserId: true, titleI18n: true, availabilityConfirmedAt: true },
    });

    let nudged = 0;
    let paused = 0;
    for (const p of live) {
      const ageDays = Math.floor((now - p.availabilityConfirmedAt!.getTime()) / DAY_MS);
      const title = (p.titleI18n as { en?: string })?.en ?? 'your listing';

      if (ageDays >= AVAILABILITY_CONFIRM_DAYS) {
        await this.prisma.property.update({ where: { id: p.id }, data: { status: 'paused' } });
        this.events.emit('listing.unlisted', { propertyId: p.id });
        await this.notifications.notify(p.createdByUserId, 'availability.paused', {
          propertyId: p.id,
          title,
        });
        paused++;
      } else if (ageDays === 83 || ageDays === 88) {
        await this.notifications.notify(p.createdByUserId, 'availability.confirm_needed', {
          propertyId: p.id,
          title,
          daysLeft: AVAILABILITY_CONFIRM_DAYS - ageDays,
        });
        nudged++;
      }
    }
    this.logger.log(`Freshness sweep: ${nudged} nudged, ${paused} paused, ${live.length} live checked`);
    return { checked: live.length, nudged, paused };
  }
}
