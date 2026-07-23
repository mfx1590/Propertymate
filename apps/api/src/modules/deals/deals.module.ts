import { Module } from '@nestjs/common';
import { DealsController, ReviewsController } from './deals.controllers';
import { DealsService } from './deals.service';
import { RatingsService } from './ratings.service';

@Module({
  controllers: [DealsController, ReviewsController],
  providers: [DealsService, RatingsService],
  exports: [DealsService, RatingsService],
})
export class DealsModule {}
