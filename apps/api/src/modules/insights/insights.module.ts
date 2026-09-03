import { Module } from '@nestjs/common';
import { InsightsAdminController, InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';

@Module({
  controllers: [InsightsController, InsightsAdminController],
  providers: [InsightsService],
  exports: [InsightsService],
})
export class InsightsModule {}
