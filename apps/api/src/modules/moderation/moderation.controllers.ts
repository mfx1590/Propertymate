import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ModerationService } from './moderation.service';

/** Profile-owner facing: report a review about you, and track what happened (§13.2). */
@Controller()
export class ReviewReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @RequirePermissions('review.report')
  @Post('reviews/:ratingId/report')
  report(
    @CurrentUser() user: AuthUser,
    @Param('ratingId') ratingId: string,
    @Body() body: { reason: string },
    @Ip() ip: string,
  ) {
    return this.moderation.report(user.sub, ratingId, body?.reason ?? '', ip);
  }

  @RequirePermissions('review.report')
  @Get('users/me/review-reports')
  mine(@CurrentUser() user: AuthUser) {
    return this.moderation.myReports(user.sub);
  }

  /** Your own strikes — a warning nobody can see is not a warning. */
  @Get('users/me/warnings')
  myWarnings(@CurrentUser() user: AuthUser) {
    return this.moderation.warningsFor(user.sub);
  }
}

/** Admin moderation queue (§13.2, §6.7). */
@RequirePermissions('review.moderate')
@Controller('admin/review-reports')
export class AdminModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.moderation.adminList(status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.moderation.adminDetail(id);
  }

  @Post(':id/decide')
  decide(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { action: string; note?: string; warn?: boolean },
    @Ip() ip: string,
  ) {
    return this.moderation.decide(admin.sub, id, body ?? {}, ip);
  }
}

/** Warnings surfaced on the existing admin user-management screens (§6.7). */
@RequirePermissions('user.manage')
@Controller('admin/users')
export class AdminUserWarningsController {
  constructor(private readonly moderation: ModerationService) {}

  @Get(':id/warnings')
  list(@Param('id') id: string) {
    return this.moderation.warningsFor(id);
  }

  /**
   * Warn directly, outside the review queue — the same counter and the same
   * automatic ban, so there is only one escalation path to reason about.
   */
  @Post(':id/warnings')
  warn(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Ip() ip: string,
  ) {
    return this.moderation.warn(admin.sub, id, body?.reason ?? '', 'admin_manual', null, ip);
  }
}
