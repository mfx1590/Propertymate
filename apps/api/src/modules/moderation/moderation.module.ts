import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AdminModerationController,
  AdminUserWarningsController,
  ReviewReportsController,
} from './moderation.controllers';
import { ModerationService } from './moderation.service';

/**
 * Review moderation (Plan §13.2): report → admin queue → warnings → ban.
 *
 * MarketplaceModule supplies SettingsService, because the warning limit before
 * a ban is admin-configurable rather than a constant in this file.
 */
@Module({
  imports: [MarketplaceModule, NotificationsModule],
  controllers: [ReviewReportsController, AdminModerationController, AdminUserWarningsController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
