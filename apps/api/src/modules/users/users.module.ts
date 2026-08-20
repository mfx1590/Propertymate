import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { NextStepsService } from './next-steps.service';

@Module({
  imports: [MarketplaceModule], // SubscriptionsService for the next-steps gate
  controllers: [UsersController, ProfilesController],
  providers: [UsersService, ProfilesService, NextStepsService],
  exports: [UsersService, ProfilesService, NextStepsService],
})
export class UsersModule {}
