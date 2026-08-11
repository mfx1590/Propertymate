import { Module } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module';
import { AdminDisputesController, DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

/**
 * Dispute centre (Plan §6.7). Depends on DealsModule for ReputationService:
 * an upheld dispute is a ranking input, so resolving one recomputes the
 * respondent's score straight away.
 */
@Module({
  imports: [DealsModule],
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
