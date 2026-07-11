import { BadRequestException, Controller, Ip, NotFoundException, Param, Post } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Minimal approve/reject so the listing loop closes end-to-end.
 * The full verification dashboard (per-document decisions, checklist,
 * fraud tools) is Phase 1 step 4 and will supersede these internals.
 */
@Controller('admin/listings')
export class AdminListingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  @RequirePermissions('verification.review')
  @Post(':id/approve')
  async approve(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Ip() ip: string) {
    const property = await this.prisma.property.findUnique({ where: { id, deletedAt: null } });
    if (!property) throw new NotFoundException('Listing not found');
    if (property.status !== 'pending_verification') {
      throw new BadRequestException(`Listing is ${property.status}, not pending_verification`);
    }

    await this.prisma.$transaction([
      this.prisma.property.update({
        where: { id },
        data: { status: 'live', availabilityConfirmedAt: new Date() },
      }),
      this.prisma.document.updateMany({
        where: { entityType: 'listing', entityId: id, status: 'pending' },
        data: { status: 'approved' },
      }),
      this.prisma.verificationItem.updateMany({
        where: { entityType: 'listing', entityId: id, status: { in: ['queued', 'claimed'] } },
        data: { status: 'approved', claimedByAdminId: admin.sub, decidedAt: new Date() },
      }),
    ]);

    await this.audit.log({
      actorId: admin.sub,
      action: 'listing.approve',
      entityType: 'property',
      entityId: id,
      before: { status: property.status },
      after: { status: 'live' },
      ip,
    });
    this.events.emit('listing.live', { propertyId: id });
    return { id, status: 'live' };
  }
}
