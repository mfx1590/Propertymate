import { Module } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { ChatController, OffersController, ViewingsController } from './chat.controllers';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ScrubService } from './scrub.service';
import { OffersService, ViewingsService } from './viewings-offers.service';

@Module({
  // DealsModule: OffersService spins up the deal room on acceptance.
  // MarketplaceModule: SettingsService owns the offers on/off toggle.
  imports: [DealsModule, MarketplaceModule],
  controllers: [ChatController, ViewingsController, OffersController],
  providers: [ChatService, ScrubService, ViewingsService, OffersService, ChatGateway],
  exports: [ChatService], // project inquiries open threads through the same service
})
export class ChatModule {}
