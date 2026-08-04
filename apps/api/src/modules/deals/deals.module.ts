import { Module } from '@nestjs/common';
import { DealsController, ReviewsController } from './deals.controllers';
import { DealsService } from './deals.service';
import { RatingsService } from './ratings.service';
import { ReputationService } from './reputation.service';

@Module({
  controllers: [DealsController, ReviewsController],
  providers: [DealsService, RatingsService, ReputationService],
  exports: [DealsService, RatingsService, ReputationService],
})
export class DealsModule {}
