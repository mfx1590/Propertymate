import { Body, Controller, Delete, Get, Ip, Param, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AssignmentsService } from './assignments.service';
import { SettingsService } from './settings.service';
import { SubscriptionsService } from './subscriptions.service';
import { GrantSubscriptionDto } from './dto/grant.dto';

@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get('public')
  publicSettings() {
    return this.settings.publicSettings();
  }

  /** Display-only conversion rates for the currency switcher (§6.1). */
  @Public()
  @Get('fx-rates')
  fxRates() {
    return this.settings.fxRates();
  }
}

@RequirePermissions('user.manage')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Every declared setting with its effective value and where that value came
   * from, followed by any row in the table that answers to no declaration.
   * The console needs both: a knob nothing reads must be visibly different
   * from one that is live, which is precisely what listing the raw table could
   * not show.
   */
  @Get()
  all() {
    return this.settings.all();
  }

  /** Write a setting, or reset it to its declared default with `null`. */
  @Put(':key')
  set(@Param('key') key: string, @Body() body: { value: unknown }) {
    return this.settings.set(key, body.value ?? null);
  }

  @Get('profit-bands/list')
  bands() {
    return this.settings.listBands();
  }

  @Post('profit-bands')
  createBand(@Body() body: { minPriceGbp: number; maxPriceGbp: number; profitGbp: number }) {
    return this.settings.createBand(body);
  }

  @Put('profit-bands/:id')
  updateBand(@Param('id') id: string, @Body() body: Record<string, never>) {
    return this.settings.updateBand(id, body);
  }

  @Delete('profit-bands/:id')
  deleteBand(@Param('id') id: string) {
    return this.settings.deleteBand(id);
  }
}

@Controller()
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get('users/me/subscriptions')
  mine(@CurrentUser() user: AuthUser) {
    return this.subs.mySubscriptions(user.sub);
  }

  @Public()
  @Get('plans')
  plans() {
    return this.subs.listPlans();
  }

  @RequirePermissions('user.manage')
  @Get('admin/subscriptions')
  adminList() {
    return this.subs.adminList();
  }

  @RequirePermissions('user.manage')
  @Post('admin/subscriptions/grant')
  grant(
    @CurrentUser() admin: AuthUser,
    @Body() body: GrantSubscriptionDto,
    @Ip() ip: string,
  ) {
    return this.subs.grant(admin.sub, body.identifier, body.planKey, body.months, ip, body.payment);
  }

  @RequirePermissions('user.manage')
  @Post('admin/subscriptions/:id/revoke')
  revoke(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.subs.revoke(admin.sub, id, ip);
  }
}

@Controller()
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @RequirePermissions('listing.delegate')
  @Get('agents/directory')
  directory(@Query('region') region?: string) {
    return this.assignments.agentDirectory(region);
  }

  @RequirePermissions('listing.delegate')
  @Post('properties/:id/assignments')
  invite(
    @CurrentUser() user: AuthUser,
    @Param('id') propertyId: string,
    @Body() body: { agentUserIds: string[]; termMonths: number },
    @Ip() ip: string,
  ) {
    return this.assignments.invite(user.sub, propertyId, body.agentUserIds ?? [], Number(body.termMonths), ip);
  }

  @RequirePermissions('listing.delegate')
  @Get('properties/:id/assignments')
  forProperty(@CurrentUser() user: AuthUser, @Param('id') propertyId: string) {
    return this.assignments.forProperty(user.sub, propertyId);
  }

  @RequirePermissions('listing.manage.mandated')
  @Get('users/me/assignments')
  mine(@CurrentUser() user: AuthUser) {
    return this.assignments.myAssignments(user.sub);
  }

  @RequirePermissions('listing.manage.mandated')
  @Get('users/me/published')
  myPublished(@CurrentUser() user: AuthUser) {
    return this.assignments.myPublished(user.sub);
  }

  @RequirePermissions('listing.manage.mandated')
  @Post('assignments/:id/respond')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { action: 'accept' | 'reject' },
    @Ip() ip: string,
  ) {
    return this.assignments.respond(user.sub, id, body.action === 'accept', ip);
  }

  @RequirePermissions('listing.manage.mandated')
  @Post('assignments/:id/publish')
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { commissionGbp: number },
    @Ip() ip: string,
  ) {
    return this.assignments.publish(user.sub, id, Number(body.commissionGbp), ip);
  }

  @RequirePermissions('verification.review')
  @Get('admin/mediated-listings')
  mediated() {
    return this.assignments.mediatedListings();
  }
}
