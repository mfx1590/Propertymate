import { Controller, Get } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics endpoints (Plan §6.7, §13.1).
 *
 * Nothing here accepts a subject id — every scope is derived from the caller's
 * token, so `analytics.own.view` cannot be turned into a way to read a rival's
 * performance. Platform-wide numbers sit behind the admin `analytics.view`.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermissions('analytics.own.view')
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.analytics.myDashboard(user.sub);
  }

  /** Developer project comparison, within and across regions (§13.1b). */
  @RequirePermissions('analytics.own.view')
  @Get('projects/comparison')
  comparison(@CurrentUser() user: AuthUser) {
    return this.analytics.projectComparison(user.sub);
  }

  @RequirePermissions('analytics.view')
  @Get('admin/overview')
  admin() {
    return this.analytics.adminOverview();
  }
}
