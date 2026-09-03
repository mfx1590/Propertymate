import { Body, Controller, Get, Ip, Param, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { LegalService } from './legal.service';
import { QuoteDto, RequestQuotesDto } from './dto/legal.dto';

/**
 * The public half of the lawyer marketplace (§10.2).
 *
 * Public on purpose: a foreign buyer's first question is whether anyone on this
 * platform can act for them, and answering it should not require an account.
 * Only verified lawyers are ever returned, and only what they chose to publish.
 */
@SkipThrottle()
@Controller('lawyers')
export class LawyersController {
  constructor(private readonly legal: LegalService) {}

  @Public()
  @Get('directory')
  directory(@Query('region') region?: string, @Query('language') language?: string) {
    return this.legal.directory(region, language);
  }

  @Public()
  @Get(':userId')
  profile(@Param('userId') userId: string) {
    return this.legal.publicProfile(userId);
  }
}

/**
 * Requesting a quote reuses `deal.participate` rather than inventing a
 * permission: every party to a deal already holds it, and a permission per
 * counterparty is how a matrix becomes unreadable (the same call the lead inbox
 * made in Phase 2 step 5).
 */
@Controller('deals/:dealId/legal')
export class DealLegalController {
  constructor(private readonly legal: LegalService) {}

  @RequirePermissions('deal.participate')
  @Get('engagements')
  forDeal(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string) {
    return this.legal.forDeal(user.sub, dealId);
  }

  @RequirePermissions('deal.participate')
  @Post('requests')
  request(
    @CurrentUser() user: AuthUser,
    @Param('dealId') dealId: string,
    @Body() dto: RequestQuotesDto,
    @Ip() ip: string,
  ) {
    return this.legal.requestQuotes(user.sub, dealId, dto, ip);
  }
}

@Controller('legal/engagements')
export class LegalEngagementsController {
  constructor(private readonly legal: LegalService) {}

  /** A lawyer's own inbox — `legal.quote` is held only by the lawyer role. */
  @RequirePermissions('legal.quote')
  @Get()
  inbox(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.legal.inbox(user.sub, status);
  }

  @RequirePermissions('legal.quote')
  @Post(':id/quote')
  quote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: QuoteDto,
    @Ip() ip: string,
  ) {
    return this.legal.quote(user.sub, id, dto, ip);
  }

  @RequirePermissions('legal.quote')
  @Post(':id/decline')
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.legal.decline(user.sub, id, ip);
  }

  // Accepting and withdrawing belong to the client, not the lawyer, so they
  // are gated on being a deal party rather than on `legal.quote`.
  @RequirePermissions('deal.participate')
  @Post(':id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.legal.accept(user.sub, id, ip);
  }

  @RequirePermissions('deal.participate')
  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.legal.withdraw(user.sub, id, ip);
  }
}
