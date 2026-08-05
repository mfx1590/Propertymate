import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { LeadsService } from './leads.service';

/**
 * Lead inbox (Plan §6.2). Gated on `listing.create` — the permission every
 * role that can front a listing already holds, so no new permission was
 * invented for a read-only view of data those roles can already reach.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermissions('listing.create')
  @Get()
  inbox(
    @CurrentUser() user: AuthUser,
    @Query('propertyId') propertyId?: string,
    @Query('stage') stage?: string,
  ) {
    return this.leads.inbox(user.sub, { propertyId, stage });
  }
}
