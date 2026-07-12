import { Body, Controller, Get, Ip, Param, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ChatService } from './chat.service';
import { OffersService, ViewingsService } from './viewings-offers.service';

@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // rate-limited per Plan §2.4 (inquiry endpoints)
  @RequirePermissions('chat.participate')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('properties/:id/inquire')
  inquire(
    @CurrentUser() user: AuthUser,
    @Param('id') propertyId: string,
    @Body() body: { message: string },
    @Ip() ip: string,
  ) {
    return this.chat.inquire(user.sub, propertyId, body.message, ip);
  }

  @RequirePermissions('chat.participate')
  @Post('assignments/:id/conversation')
  assignmentConversation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.assignmentConversation(user.sub, id);
  }

  @RequirePermissions('chat.participate')
  @Get('users/me/conversations')
  myConversations(@CurrentUser() user: AuthUser) {
    return this.chat.myConversations(user.sub);
  }

  @RequirePermissions('chat.participate')
  @Get('conversations/:id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.messages(user.sub, id);
  }

  @RequirePermissions('chat.participate')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { message: string },
    @Ip() ip: string,
  ) {
    return this.chat.sendMessage(user.sub, id, body.message, ip);
  }
}

@Controller()
export class ViewingsController {
  constructor(private readonly viewings: ViewingsService) {}

  @RequirePermissions('viewing.request')
  @Post('properties/:id/viewings')
  request(
    @CurrentUser() user: AuthUser,
    @Param('id') propertyId: string,
    @Body() body: { scheduledAt: string; notes?: string },
  ) {
    return this.viewings.request(user.sub, propertyId, body.scheduledAt, body.notes);
  }

  @Get('users/me/viewings')
  mine(@CurrentUser() user: AuthUser) {
    return this.viewings.mine(user.sub);
  }

  @Put('viewings/:id/status')
  setStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { status: string }) {
    return this.viewings.setStatus(user.sub, id, body.status);
  }
}

@Controller()
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @RequirePermissions('offer.create')
  @Post('properties/:id/offers')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id') propertyId: string,
    @Body() body: { amount: number; currency: string; termsNote?: string },
  ) {
    return this.offers.submit(user.sub, propertyId, Number(body.amount), body.currency ?? 'GBP', body.termsNote);
  }

  @Get('users/me/offers')
  mine(@CurrentUser() user: AuthUser) {
    return this.offers.mine(user.sub);
  }

  @Post('offers/:id/counter')
  counter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { amount: number; termsNote?: string },
  ) {
    return this.offers.counter(user.sub, id, Number(body.amount), body.termsNote);
  }

  @Post('offers/:id/respond')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { action: 'accept' | 'reject' | 'withdraw' },
    @Ip() ip: string,
  ) {
    return this.offers.respond(user.sub, id, body.action, ip);
  }
}
