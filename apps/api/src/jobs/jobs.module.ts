import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { VerificationModule } from '../modules/verification/verification.module';
import { MarketplaceModule } from '../modules/marketplace/marketplace.module';
import { DealsModule } from '../modules/deals/deals.module';
import { SearchModule } from '../modules/search/search.module';
import { MaintenanceProcessor } from './maintenance.processor';
import { NotificationQueueProducer, NotificationsProcessor } from './notifications.processor';
import { MAINTENANCE_QUEUE, NOTIFICATIONS_QUEUE } from './jobs.constants';

/** Daily repeatable maintenance jobs (cron patterns), keyed for idempotent registration. */
const SCHEDULE: { name: string; pattern: string }[] = [
  { name: 'freshness', pattern: '0 6 * * *' }, // 06:00 — 90-day availability sweep
  { name: 'assignment-expiry', pattern: '0 5 * * *' }, // 05:00 — expire elapsed mandates
  { name: 'rating-reveal', pattern: '0 1 * * *' }, // 01:00 — reveal stale one-sided ratings
  { name: 'reputation', pattern: '0 2 * * *' }, // 02:00 — after reveals, so scores see them
  { name: 'recommendations', pattern: '0 3 * * *' }, // 03:00 — co-visitation rebuild (§8)
  { name: 'featured-expiry', pattern: '0 4 * * *' }, // 04:00 — lapse credits + featured windows (§8)
];

@Injectable()
class MaintenanceScheduler implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceScheduler.name);
  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // clear stale repeatables, then (re)register the current schedule — safe across restarts
    const existing = await this.queue.getJobSchedulers().catch(() => []);
    for (const s of existing) {
      if (s.key) await this.queue.removeJobScheduler(s.key).catch(() => undefined);
    }
    for (const job of SCHEDULE) {
      await this.queue.upsertJobScheduler(job.name, { pattern: job.pattern }, { name: job.name });
    }
    this.logger.log(`Registered ${SCHEDULE.length} repeatable maintenance jobs`);
  }
}

/**
 * BullMQ-backed scheduled jobs (Plan §11). Moving off @nestjs/schedule means
 * each job runs exactly once across N app instances (Redis-coordinated),
 * instead of once per instance. Job handlers delegate to the existing
 * domain services; the admin endpoints can still trigger them on demand.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: Number(config.get<string>('REDIS_PORT') ?? 6379),
        },
      }),
    }),
    BullModule.registerQueue({ name: MAINTENANCE_QUEUE }, { name: NOTIFICATIONS_QUEUE }),
    VerificationModule,
    MarketplaceModule,
    DealsModule,
    SearchModule,
  ],
  providers: [
    MaintenanceProcessor,
    MaintenanceScheduler,
    NotificationQueueProducer,
    NotificationsProcessor,
  ],
})
export class JobsModule {}
