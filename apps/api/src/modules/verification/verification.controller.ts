import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentDecision, VerificationService } from './verification.service';

@RequirePermissions('verification.review')
@Controller('admin/verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('queue')
  queue(
    @Query('entityType') entityType?: string,
    @Query('status') status?: string,
    @Query('overdue') overdue?: string,
  ) {
    return this.verification.queue({ entityType, status, overdueOnly: overdue === 'true' });
  }

  @Get('metrics')
  metrics() {
    return this.verification.metrics();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.verification.detail(id);
  }

  @Post(':id/claim')
  claim(@CurrentUser() admin: AuthUser, @Param('id') id: string) {
    return this.verification.claim(admin.sub, id);
  }

  @Post(':id/decision')
  decide(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { documentDecisions: DocumentDecision[]; note?: string },
    @Ip() ip: string,
  ) {
    return this.verification.decide(admin.sub, id, body.documentDecisions ?? [], body.note, ip);
  }
}
