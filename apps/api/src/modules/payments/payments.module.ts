import { Global, Module } from '@nestjs/common';
import { MyPaymentsController, PaymentsAdminController } from './payments.controller';
import { PaymentsService } from './payments.service';

// global: SubscriptionsService writes a ledger row on every grant, and the
// marketplace module is imported in enough places that a normal import cycle
// would tangle the graph — the same call NotificationsModule made.
@Global()
@Module({
  controllers: [PaymentsAdminController, MyPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
