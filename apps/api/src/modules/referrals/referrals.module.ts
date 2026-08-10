import { Global, Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ReferralsController } from './referrals.controller';
import { ReferralsService } from './referrals.service';

/**
 * Referral codes + featured-listing credits (Plan §8).
 * Global because the auth module attaches a code at signup; everything else
 * reaches it through the `listing.live` domain event.
 */
@Global()
@Module({
  imports: [MarketplaceModule], // SettingsService for the configurable windows
  controllers: [ReferralsController],
  providers: [ReferralsService],
  exports: [ReferralsService],
})
export class ReferralsModule {}
