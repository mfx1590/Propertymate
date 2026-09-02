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

  /** The agent mandate for an assignment (§13.4), or null before it exists. */
  @Get('assignments/:id/mandate')
  async mandate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    // Wrapped, matching `forDeal` above: returning a bare `null` gives an empty
    // 200 body, and the web client's `res.json()` throws on that rather than
    // reporting "no mandate yet".
    return { mandate: await this.contracts.mandateForAssignment(user.sub, id) };
  }

  @Post('assignments/:id/mandate')
  generateMandate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    return this.contracts.generateForAssignment(user.sub, id, ip);
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
