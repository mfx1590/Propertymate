import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from '@propverify/shared';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('users/me')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.listFor(user.sub);
  }

  /** Per-channel delivery outcomes for the caller (§6.6 transparency). */
  @Get('notification-deliveries')
  deliveries(@CurrentUser() user: AuthUser) {
    return this.notifications.deliveriesFor(user.sub);
  }

  @Post('notifications/read-all')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.sub);
  }

  // ── channel preferences (§6.6) ───────────────────────────────────

  @Get('notification-preferences')
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.preferencesFor(user.sub);
  }

  @Put('notification-preferences/:category')
  setPreference(
    @CurrentUser() user: AuthUser,
    @Param('category') category: string,
    @Body() body: { channels: string[] },
  ) {
    const cat = this.assertCategory(category);
    const channels = body?.channels ?? [];
    if (!Array.isArray(channels)) throw new BadRequestException('channels must be an array');
    const invalid = channels.filter((c) => !NOTIFICATION_CHANNELS.includes(c as NotificationChannel));
    if (invalid.length) throw new BadRequestException(`Unknown channel(s): ${invalid.join(', ')}`);
    return this.notifications.setPreference(user.sub, cat, channels as NotificationChannel[]);
  }

  /** Back to platform defaults, so a later default change reaches this user. */
  @Delete('notification-preferences/:category')
  resetPreference(@CurrentUser() user: AuthUser, @Param('category') category: string) {
    return this.notifications.resetPreference(user.sub, this.assertCategory(category));
  }

  // ── push devices (§6.6, consumed by the Expo app in Phase 2) ─────

  @Post('push-tokens')
  registerToken(@CurrentUser() user: AuthUser, @Body() body: { token: string; platform?: string }) {
    const token = body?.token?.trim();
    if (!token) throw new BadRequestException('token is required');
    return this.notifications.registerPushToken(user.sub, token, body.platform);
  }

  @Delete('push-tokens/:token')
  removeToken(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.notifications.removePushToken(user.sub, token);
  }

  private assertCategory(value: string): NotificationCategory {
    if (!NOTIFICATION_CATEGORIES.includes(value as NotificationCategory)) {
      throw new BadRequestException(`Unknown category: ${value}`);
    }
    return value as NotificationCategory;
  }
}
