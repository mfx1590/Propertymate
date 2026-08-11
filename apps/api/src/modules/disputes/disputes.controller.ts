import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DisputesService } from './disputes.service';

/** Party-facing: open and track your own disputes (Plan §6.7). */
@Controller()
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @RequirePermissions('dispute.open')
  @Post('deals/:dealId/disputes')
  open(
    @CurrentUser() user: AuthUser,
    @Param('dealId') dealId: string,
    @Body() body: { againstUserId: string; reason: string },
    @Ip() ip: string,
  ) {
    return this.disputes.open(user.sub, dealId, body?.againstUserId, body?.reason ?? '', ip);
  }

  @RequirePermissions('dispute.open')
  @Get('users/me/disputes')
  mine(@CurrentUser() user: AuthUser) {
    return this.disputes.mine(user.sub);
  }
}

/** Admin dispute centre — queue, evidence bundle, decision (§6.7). */
@RequirePermissions('dispute.resolve')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.disputes.adminList(status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.disputes.adminDetail(id);
  }

  @Post(':id/resolve')
  resolve(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { status: string; resolutionNote?: string },
    @Ip() ip: string,
  ) {
    return this.disputes.resolve(admin.sub, id, body?.status, body?.resolutionNote ?? '', ip);
  }
}
