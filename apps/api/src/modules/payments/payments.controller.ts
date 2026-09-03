import { Body, Controller, Get, Ip, Param, Post, Put, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto, SetPlanPriceDto } from './dto/payments.dto';

/**
 * Payments is admin-facing only at this stage: an admin prices a plan and
 * records what was collected. There is no self-serve checkout, because there
 * is no provider yet — and a "Subscribe" button that cannot take money would
 * be worse than none.
 *
 * Gated on `user.manage` rather than a new `payment.manage` permission: the
 * people who grant subscriptions by hand are exactly the people who record
 * what was paid for them, and splitting the two would invent a role nobody
 * holds.
 */
@RequirePermissions('user.manage')
@Controller('admin')
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  @Put('plans/:key/price')
  setPrice(
    @CurrentUser() admin: AuthUser,
    @Param('key') key: string,
    @Body() dto: SetPlanPriceDto,
    @Ip() ip: string,
  ) {
    return this.payments.setPlanPrice(admin.sub, key, dto, ip);
  }

  @Get('payments')
  ledger(@Query('cursor') cursor?: string) {
    return this.payments.adminLedger(cursor);
  }

  @Post('payments/:id/reverse')
  reverse(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: { note?: string },
    @Ip() ip: string,
  ) {
    return this.payments.reverse(admin.sub, id, body?.note, ip);
  }

  @Get('payments/providers')
  providers() {
    return { providers: this.payments.providers() };
  }
}

@Controller('users/me')
export class MyPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** What this account has been charged, and what was comped. */
  @Get('payments')
  mine(@CurrentUser() user: AuthUser) {
    return this.payments.mine(user.sub);
  }
}

export { RecordPaymentDto };
