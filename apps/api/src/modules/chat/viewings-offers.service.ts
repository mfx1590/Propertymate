import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DealsService } from '../deals/deals.service';

const VIEWING_TRANSITIONS: Record<string, string[]> = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled', 'no_show'],
};

@Injectable()
export class ViewingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async request(customerId: string, propertyId: string, scheduledAt: string, notes?: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      select: { status: true, createdByUserId: true, publishedByAgentId: true, titleI18n: true },
    });
    if (!property || !['live', 'under_offer'].includes(property.status)) {
      throw new NotFoundException('Listing not available');
    }
    const when = new Date(scheduledAt);
    if (!(when > new Date())) throw new BadRequestException('Viewing time must be in the future');

    const hostUserId = property.publishedByAgentId ?? property.createdByUserId;
    if (hostUserId === customerId) throw new BadRequestException('You manage this listing');

    const viewing = await this.prisma.viewing.create({
      data: { propertyId, customerId, hostUserId, scheduledAt: when, notes },
    });
    await this.notifications.notify(hostUserId, 'viewing.requested', {
      viewingId: viewing.id,
      title: (property.titleI18n as { en?: string })?.en ?? 'your listing',
    });
    return viewing;
  }

  async setStatus(userId: string, viewingId: string, status: string) {
    const viewing = await this.prisma.viewing.findUnique({ where: { id: viewingId } });
    if (!viewing) throw new NotFoundException('Viewing not found');

    const isHost = viewing.hostUserId === userId;
    const isCustomer = viewing.customerId === userId;
    if (!isHost && !isCustomer) throw new ForbiddenException('Not your viewing');
    // customers may only cancel; hosts drive the rest
    if (isCustomer && !isHost && status !== 'cancelled') {
      throw new ForbiddenException('Only the host can change this status');
    }
    if (!VIEWING_TRANSITIONS[viewing.status]?.includes(status)) {
      throw new BadRequestException(`Cannot go from ${viewing.status} to ${status}`);
    }

    const updated = await this.prisma.viewing.update({ where: { id: viewingId }, data: { status: status as never } });
    const counterpart = isHost ? viewing.customerId : viewing.hostUserId;
    await this.notifications.notify(counterpart, `viewing.${status}`, { viewingId });
    return updated;
  }

  async mine(userId: string) {
    return this.prisma.viewing.findMany({
      where: { OR: [{ customerId: userId }, { hostUserId: userId }] },
      include: {
        property: { select: { id: true, titleI18n: true, region: { select: { slug: true } } } },
      },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    });
  }
}

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly deals: DealsService,
    private readonly events: EventEmitter2,
  ) {}

  async submit(customerId: string, propertyId: string, amount: number, currency: string, termsNote?: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      select: { status: true, createdByUserId: true, publishedByAgentId: true, titleI18n: true },
    });
    if (!property || property.status !== 'live') throw new NotFoundException('Listing not available');
    if (!(amount > 0)) throw new BadRequestException('Offer amount must be positive');

    const listerId = property.publishedByAgentId ?? property.createdByUserId;
    if (listerId === customerId) throw new BadRequestException('You manage this listing');

    const offer = await this.prisma.offer.create({
      data: { propertyId, customerId, amount, currency, termsNote },
    });
    await this.notifications.notify(listerId, 'offer.received', {
      offerId: offer.id,
      title: (property.titleI18n as { en?: string })?.en ?? 'your listing',
    });
    return offer;
  }

  /** Lister counters with a new amount; customer can counter back the same way. */
  async counter(userId: string, offerId: string, amount: number, termsNote?: string) {
    const { offer, listerId } = await this.loadWithLister(offerId);
    const isParty = userId === listerId || userId === offer.customerId;
    if (!isParty) throw new ForbiddenException('Not your negotiation');
    if (!['submitted', 'countered'].includes(offer.status)) {
      throw new BadRequestException(`Offer is ${offer.status}`);
    }

    await this.prisma.offer.update({ where: { id: offerId }, data: { status: 'countered' } });
    const counterOffer = await this.prisma.offer.create({
      data: {
        propertyId: offer.propertyId,
        customerId: offer.customerId,
        amount,
        currency: offer.currency,
        termsNote,
        parentOfferId: offerId,
      },
    });
    const other = userId === listerId ? offer.customerId : listerId;
    await this.notifications.notify(other, 'offer.countered', { offerId: counterOffer.id });
    return counterOffer;
  }

  async respond(userId: string, offerId: string, action: 'accept' | 'reject' | 'withdraw', ip?: string) {
    const { offer, listerId } = await this.loadWithLister(offerId);
    if (!['submitted', 'countered'].includes(offer.status)) {
      throw new BadRequestException(`Offer is ${offer.status}`);
    }

    if (action === 'withdraw') {
      if (userId !== offer.customerId) throw new ForbiddenException('Only the offerer can withdraw');
      return this.prisma.offer.update({ where: { id: offerId }, data: { status: 'withdrawn' } });
    }

    if (userId !== listerId) throw new ForbiddenException('Only the lister can accept or reject');
    const updated = await this.prisma.offer.update({
      where: { id: offerId },
      data: { status: action === 'accept' ? 'accepted' : 'rejected' },
    });

    if (action === 'accept') {
      // §7: lock the listing, freeze the snapshot, open the deal room
      await this.prisma.property.update({
        where: { id: offer.propertyId },
        data: { status: 'under_offer' },
      });
      this.events.emit('listing.unlisted', { propertyId: offer.propertyId });
      await this.audit.log({
        actorId: userId,
        action: 'offer.accept',
        entityType: 'offer',
        entityId: offerId,
        after: { amount: Number(offer.amount), currency: offer.currency },
        ip,
      });
      const dealId = await this.deals.createFromAcceptedOffer(offerId);
      await this.notifications.notify(offer.customerId, 'offer.accepted', { offerId, dealId });
      return { ...updated, dealId };
    }
    await this.notifications.notify(offer.customerId, `offer.${action}ed`, { offerId });
    return updated;
  }

  async mine(userId: string) {
    const sent = await this.prisma.offer.findMany({
      where: { customerId: userId },
      include: { property: { select: { id: true, titleI18n: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const listings = await this.prisma.property.findMany({
      where: {
        OR: [{ createdByUserId: userId }, { publishedByAgentId: userId }],
        deletedAt: null,
      },
      select: { id: true },
    });
    const received = await this.prisma.offer.findMany({
      where: { propertyId: { in: listings.map((l) => l.id) }, customerId: { not: userId } },
      include: { property: { select: { id: true, titleI18n: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { sent, received };
  }

  private async loadWithLister(offerId: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Offer not found');
    const property = await this.prisma.property.findUnique({
      where: { id: offer.propertyId },
      select: { createdByUserId: true, publishedByAgentId: true },
    });
    if (!property) throw new NotFoundException('Listing not found');
    return { offer, listerId: property.publishedByAgentId ?? property.createdByUserId };
  }
}
