import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/**
 * Lead inbox (Plan §6.2) — a read model over conversations, viewings, offers
 * and deals. It owns no tables of its own; it depends on ChatModule so the
 * §2.4 contact-reveal rule has exactly one implementation.
 */
@Module({
  imports: [ChatModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
