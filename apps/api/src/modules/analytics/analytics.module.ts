import { Module } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/** Performance dashboards for professional roles and admins (Plan §6.7, §13.1). */
@Module({
  imports: [DealsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
