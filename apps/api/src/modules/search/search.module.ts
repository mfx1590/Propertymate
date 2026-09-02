import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertsService } from './alerts.service';
import { RecommendationsService } from './recommendations.service';
import { AlertsAdminController, SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * MarketplaceModule and NotificationsModule are here for AlertsService only:
 * the §6.1 alert sweeps read a platform setting for the price-drop threshold
 * and deliver through the standard notification fan-out.
 */
@Module({
  imports: [MarketplaceModule, NotificationsModule],
  controllers: [SearchController, AlertsAdminController],
  providers: [SearchService, RecommendationsService, AlertsService],
  exports: [SearchService, RecommendationsService, AlertsService],
})
export class SearchModule {}
