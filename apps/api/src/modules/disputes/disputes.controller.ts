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

  /** One case as a party sees it — never the admin evidence bundle (§2.4). */
  @RequirePermissions('dispute.open')
  @Get('disputes/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.disputes.detailForParty(user.sub, id);
  }

  @RequirePermissions('dispute.open')
  @Post('disputes/:id/statements')
  statement(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { body: string },
    @Ip() ip: string,
  ) {
    return this.disputes.addStatement(user.sub, id, body?.body ?? '', {}, ip);
  }

  @RequirePermissions('dispute.open')
  @Post('disputes/:id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.disputes.withdraw(user.sub, id, ip);
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

  /** An admin's question or note, on the record, visible to both parties. */
  @Post(':id/statements')
  statement(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { body: string },
    @Ip() ip: string,
  ) {
    return this.disputes.addStatement(admin.sub, id, body?.body ?? '', { asAdmin: true }, ip);
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
