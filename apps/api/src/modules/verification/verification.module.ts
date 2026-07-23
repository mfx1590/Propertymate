import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { FreshnessService } from './freshness.service';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { FreshnessAdminController } from './freshness-admin.controller';

@Module({
  imports: [MediaModule],
  controllers: [VerificationController, FreshnessAdminController],
  providers: [VerificationService, FreshnessService],
  exports: [FreshnessService],
})
export class VerificationModule {}
