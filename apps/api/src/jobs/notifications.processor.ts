import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import type { Job, Queue } from 'bullmq';
import { NotificationDispatcher } from '../modules/notifications/dispatcher.service';
import { NOTIFICATIONS_QUEUE } from './jobs.constants';

interface QueuedNotification {
  notificationId: string;
  channel: string;
}

/**
 * Producer for the notifications queue.
 *
 * Sits in the jobs module and listens for a domain event rather than being
 * injected into NotificationsService: that service is `@Global` and used by
 * almost every module, so importing the jobs module from it would tangle the
 * whole dependency graph.
 */
@Injectable()
export class NotificationQueueProducer {
  private readonly logger = new Logger(NotificationQueueProducer.name);

  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  @OnEvent('notification.queued')
  async enqueue(payload: QueuedNotification) {
    try {
      await this.queue.add('deliver', payload, {
        attempts: 4,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 1_000,
      });
    } catch (err) {
      // the in-app row is already written, so a Redis blip costs the outside
      // channels, never the notification itself
      this.logger.error(`Failed to enqueue notification ${payload.notificationId}: ${err}`);
    }
  }
}

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly dispatcher: NotificationDispatcher) {
    super();
  }

  async process(job: Job<QueuedNotification>): Promise<unknown> {
    const { notificationId, channel } = job.data;
    const { retry, status } = await this.dispatcher.deliver(notificationId);

    if (retry) {
      // Throwing is how BullMQ knows to apply the backoff. Non-retryable
      // failures return normally — the row already records the error, and
      // re-POSTing a payload the provider rejected would never succeed.
      throw new Error(`${channel} delivery failed for ${notificationId}, retrying`);
    }
    if (status === 'failed') {
      this.logger.warn(`${channel} delivery for ${notificationId} failed permanently`);
    }
    return { notificationId, channel, status };
  }
}
