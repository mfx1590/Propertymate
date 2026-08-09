import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractPdfService } from './pdf.service';

/** Platform-generated contracts and typed e-sign (Plan §7, §6.2). */
@Module({
  controllers: [ContractsController],
  providers: [ContractsService, ContractPdfService],
  exports: [ContractsService],
})
export class ContractsModule {}
