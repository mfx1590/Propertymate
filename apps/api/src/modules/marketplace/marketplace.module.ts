import { Module } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import {
  AdminSettingsController,
  AssignmentsController,
  PublicSettingsController,
  SubscriptionsController,
} from './marketplace.controllers';
import { SettingsService } from './settings.service';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  controllers: [
    PublicSettingsController,
    AdminSettingsController,
    SubscriptionsController,
    AssignmentsController,
  ],
  providers: [SettingsService, SubscriptionsService, AssignmentsService],
  exports: [SettingsService, SubscriptionsService],
})
export class MarketplaceModule {}
