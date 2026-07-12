import { Module } from '@nestjs/common';
import { ChatController, OffersController, ViewingsController } from './chat.controllers';
import { ChatService } from './chat.service';
import { ScrubService } from './scrub.service';
import { OffersService, ViewingsService } from './viewings-offers.service';

@Module({
  controllers: [ChatController, ViewingsController, OffersController],
  providers: [ChatService, ScrubService, ViewingsService, OffersService],
})
export class ChatModule {}
