import { Body, Controller, Get, Ip, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ContractsService } from './contracts.service';

/**
 * Contract generation + typed e-sign (Plan §7, §6.2).
 * Gated on `deal.participate`; the service then enforces that the caller is
 * actually a party to the specific deal.
 */
@RequirePermissions('deal.participate')
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  /**
   * Wrapped rather than returning a bare `null`: Nest serialises null as an
   * empty body, which every `res.json()` on the other side would throw on.
   */
  @Get('deals/:dealId/contract')
  async forDeal(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string) {
    return { contract: await this.contracts.forDeal(user.sub, dealId) };
  }

  @Post('deals/:dealId/contract')
  generate(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string, @Ip() ip: string) {
    return this.contracts.generateForDeal(user.sub, dealId, ip);
  }

  @Get('contracts/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contracts.detail(user.sub, id);
  }

  @Post('contracts/:id/sign')
  sign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { typedName: string },
    @Ip() ip: string,
  ) {
    return this.contracts.sign(user.sub, id, body?.typedName ?? '', ip);
  }
}
