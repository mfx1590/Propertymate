import { Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ReferralsService } from './referrals.service';

/**
 * Referrals (Plan §8). Everyone can invite — the code belongs to the account,
 * not to a role — so the overview is gated only on being signed in. Spending a
 * credit needs a listing, hence `listing.create`.
 */
@Controller()
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('users/me/referrals')
  overview(@CurrentUser() user: AuthUser) {
    return this.referrals.overview(user.sub);
  }

  @RequirePermissions('listing.create')
  @Post('properties/:id/feature')
  feature(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.referrals.featureListing(user.sub, id, ip);
  }
}
