import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { FreshnessService } from '../modules/verification/freshness.service';
import { AssignmentsService } from '../modules/marketplace/assignments.service';
import { RatingsService } from '../modules/deals/ratings.service';
import { ReputationService } from '../modules/deals/reputation.service';
import { RecommendationsService } from '../modules/search/recommendations.service';
import { MAINTENANCE_QUEUE } from './jobs.constants';

/**
 * Single worker for the maintenance queue. Dispatches each repeatable job to
 * its domain service; returning the result records it on the BullMQ job.
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly freshness: FreshnessService,
    private readonly assignments: AssignmentsService,
    private readonly ratings: RatingsService,
    private readonly reputation: ReputationService,
    private readonly recommendations: RecommendationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.log(`Running maintenance job: ${job.name}`);
    switch (job.name) {
      case 'freshness':
        return this.freshness.run();
      case 'assignment-expiry':
        return this.assignments.expireSweep();
      case 'rating-reveal':
        return this.ratings.revealStale();
      case 'reputation':
        return this.reputation.recomputeAll();
      case 'recommendations':
        return this.recommendations.rebuild();
      default:
        this.logger.warn(`Unknown maintenance job: ${job.name}`);
        return { skipped: job.name };
    }
  }
}
