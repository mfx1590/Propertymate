import { Module } from '@nestjs/common';
import { DealsModule } from '../deals/deals.module';
import {
  DealLegalController,
  LawyersController,
  LegalEngagementsController,
} from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  imports: [DealsModule],
  controllers: [LawyersController, DealLegalController, LegalEngagementsController],
  providers: [LegalService],
  exports: [LegalService],
})
export class LegalModule {}
