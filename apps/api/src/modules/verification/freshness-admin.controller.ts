import { Controller, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { FreshnessService } from './freshness.service';

/** Manual trigger for the daily freshness sweep (ops/testing). */
@Controller('admin/jobs')
export class FreshnessAdminController {
  constructor(private readonly freshness: FreshnessService) {}

  @RequirePermissions('verification.review')
  @Post('freshness')
  run() {
    return this.freshness.run();
  }
}
