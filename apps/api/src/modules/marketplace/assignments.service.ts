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
import { SettingsService } from './settings.service';

/**
 * §13.4 find-my-agent. Invariant: agent-facing payloads NEVER include owner
 * identity or contact details — the platform mediates everything.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Verified agents the owner can pick from (stats, no contacts), best-ranked
   * first — the §8 reputation score is what makes this a directory rather than
   * an arbitrary list. Agents with no score yet sort last, not first.
   */
  async agentDirectory(regionSlug?: string) {
    const agents = await this.prisma.userRole.findMany({
      where: {
        verificationStatus: 'verified',
        role: { key: { in: ['solo_agent', 'agency'] } },
      },
      select: {
        role: { select: { key: true } },
        user: {
          select: {
            id: true,
            agentProfile: {
              select: {
                bio: true, regions: true, dealCount: true, ratingAvg: true,
                responseTimeAvgSec: true, rankingScore: true,
              },
            },
            agencyProfile: { select: { companyName: true, about: true } },
          },
        },
      },
    });
    return agents
      .map((a) => ({
        userId: a.user.id,
        type: a.role.key,
        name: a.user.agencyProfile?.companyName ?? 'Agent',
        bio: a.user.agentProfile?.bio ?? a.user.agencyProfile?.about ?? null,
        regions: a.user.agentProfile?.regions ?? [],
        dealCount: a.user.agentProfile?.dealCount ?? 0,
        ratingAvg: a.user.agentProfile?.ratingAvg ?? null,
        responseTimeAvgSec: a.user.agentProfile?.responseTimeAvgSec ?? null,
        rankingScore: a.user.agentProfile?.rankingScore ?? null,
      }))
      .filter((a) => !regionSlug || a.regions.length === 0 || a.regions.includes(regionSlug))
      .sort((a, b) => (b.rankingScore ?? -1) - (a.rankingScore ?? -1));
  }

  /** Owner invites agents to work a verified-private resale. */
  async invite(ownerId: string, propertyId: string, agentUserIds: string[], termMonths: number, ip?: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId, deletedAt: null } });
    if (!property) throw new NotFoundException('Listing not found');
    if (property.createdByUserId !== ownerId) throw new ForbiddenException('Not your listing');
    if (property.kind !== 'resale') throw new BadRequestException('Find-my-agent applies to resale listings');
    if (property.status !== 'verified_private') {
      throw new BadRequestException(`Listing must be verified first (status: ${property.status})`);
    }

    const [maxAgents, minTerm, maxTerm] = await Promise.all([
      this.settings.get('assignment.max_agents', 3),
      this.settings.get('assignment.min_term_months', 1),
      this.settings.get('assignment.max_term_months', 6),
    ]);
    const unique = [...new Set(agentUserIds)];
    if (unique.length === 0 || unique.length > Number(maxAgents)) {
      throw new BadRequestException(`Choose between 1 and ${maxAgents} agents`);
    }
    if (termMonths < Number(minTerm) || termMonths > Number(maxTerm)) {
      throw new BadRequestException(`Term must be ${minTerm}–${maxTerm} months`);
    }

    // no double-invitations while an active round exists
    const open = await this.prisma.agentAssignment.count({
      where: { propertyId, status: { in: ['invited', 'accepted'] }, expiresAt: { gt: new Date() } },
    });
    if (open > 0) throw new BadRequestException('This listing already has an active assignment round');

    // invitees must be verified agents
    const verified = await this.prisma.userRole.findMany({
      where: {
        userId: { in: unique },
        verificationStatus: 'verified',
        role: { key: { in: ['solo_agent', 'agency'] } },
      },
      select: { userId: true },
    });
    if (verified.length !== unique.length) {
      throw new BadRequestException('All chosen agents must be verified professionals');
    }

    const expiresAt = new Date(Date.now() + termMonths * 30 * 86_400_000);
    const created = await this.prisma.$transaction(
      unique.map((agentUserId) =>
        this.prisma.agentAssignment.create({
          data: { propertyId, ownerUserId: ownerId, agentUserId, termMonths, expiresAt },
        }),
      ),
    );
    for (const a of created) {
      await this.notifications.notify(a.agentUserId, 'assignment.invited', {
        assignmentId: a.id,
        title: (property.titleI18n as { en?: string })?.en ?? 'A resale property',
      });
    }
    await this.audit.log({
      actorId: ownerId,
      action: 'assignment.invite',
      entityType: 'property',
      entityId: propertyId,
      after: { agentUserIds: unique, termMonths },
      ip,
    });
    return created;
  }

  /** Agent's view — owner identity/contact intentionally absent. */
  async myAssignments(agentUserId: string) {
    const assignments = await this.prisma.agentAssignment.findMany({
      where: { agentUserId, status: { in: ['invited', 'accepted'] } },
      orderBy: { invitedAt: 'desc' },
    });
    return Promise.all(
      assignments.map(async (a) => {
        const p = await this.prisma.property.findUnique({
          where: { id: a.propertyId },
          select: {
            id: true, kind: true, titleI18n: true, descriptionI18n: true, district: true,
            bedrooms: true, bathrooms: true, areaM2: true, plotM2: true, deedType: true,
            furnished: true, features: true, priceBaseGbp: true, status: true,
            lat: true, lng: true,
            region: { select: { slug: true, nameI18n: true } },
            media: { orderBy: { sortOrder: 'asc' } },
            // NOTE: no createdBy / owner fields — anonymity is the contract (§13.4)
          },
        });
        return { ...a, property: p };
      }),
    );
  }

  /** Owner's view of their assignment rounds. */
  async forProperty(ownerId: string, propertyId: string) {
    const property = await this.prisma.property.findUnique({ where: { id: propertyId } });
    if (!property || property.createdByUserId !== ownerId) throw new ForbiddenException('Not your listing');
    return this.prisma.agentAssignment.findMany({
      where: { propertyId },
      orderBy: { invitedAt: 'desc' },
    });
  }

  async respond(agentUserId: string, assignmentId: string, accept: boolean, ip?: string) {
    const a = await this.prisma.agentAssignment.findUnique({ where: { id: assignmentId } });
    if (!a || a.agentUserId !== agentUserId) throw new NotFoundException('Assignment not found');
    if (a.status !== 'invited') throw new BadRequestException(`Assignment is ${a.status}`);
    if (a.expiresAt < new Date()) throw new BadRequestException('Assignment expired');

    const updated = await this.prisma.agentAssignment.update({
      where: { id: assignmentId },
      data: { status: accept ? 'accepted' : 'rejected', respondedAt: new Date() },
    });
    await this.notifications.notify(a.ownerUserId, accept ? 'assignment.accepted' : 'assignment.rejected', {
      assignmentId,
      propertyId: a.propertyId,
    });
    await this.audit.log({
      actorId: agentUserId,
      action: accept ? 'assignment.accept' : 'assignment.reject',
      entityType: 'agent_assignment',
      entityId: assignmentId,
      ip,
    });
    return updated;
  }

  /**
   * §13.5 buyer-pays publish: list = owner ask (GBP base) + platform band + agent commission.
   * Only an agent with an accepted, unexpired assignment can publish.
   */
  async publish(agentUserId: string, assignmentId: string, commissionGbp: number, ip?: string) {
    if (!(commissionGbp >= 0)) throw new BadRequestException('commissionGbp must be ≥ 0');
    const a = await this.prisma.agentAssignment.findUnique({ where: { id: assignmentId } });
    if (!a || a.agentUserId !== agentUserId) throw new NotFoundException('Assignment not found');
    if (a.status !== 'accepted') throw new BadRequestException('Accept the assignment first');
    if (a.expiresAt < new Date()) throw new BadRequestException('Assignment expired');

    // §6.2/§13.4: a signed mandate is what actually authorises an agent to
    // market someone else's property. Gated behind a setting and OFF by
    // default, following the `offers.enabled` precedent — the document and the
    // signing flow are complete, and turning this on makes it load-bearing
    // without a code change. Existing deployments keep working until then.
    if (await this.settings.get('mandate.required_before_publish', false)) {
      const signed = await this.prisma.contract.findFirst({
        where: { assignmentId, status: 'signed' },
        select: { id: true },
      });
      if (!signed) {
        throw new BadRequestException(
          'MANDATE_REQUIRED: both the owner and the agent must sign the mandate before publishing',
        );
      }
    }

    const property = await this.prisma.property.findUnique({ where: { id: a.propertyId } });
    if (!property) throw new NotFoundException('Listing not found');
    if (property.status !== 'verified_private') {
      throw new BadRequestException(`Listing is ${property.status}, not verified_private`);
    }

    const ask = Number(property.priceBaseGbp);
    const profit = await this.settings.profitFor(ask);
    const listPrice = Math.round((ask + profit + commissionGbp) * 100) / 100;

    const updated = await this.prisma.property.update({
      where: { id: property.id },
      data: {
        status: 'live',
        platformProfitGbp: profit,
        agentCommissionGbp: commissionGbp,
        listPriceGbp: listPrice,
        publishedByAgentId: agentUserId,
        availabilityConfirmedAt: new Date(),
      },
    });
    this.events.emit('listing.live', { propertyId: property.id });
    await this.notifications.notify(a.ownerUserId, 'assignment.published', {
      propertyId: property.id,
      title: (property.titleI18n as { en?: string })?.en ?? 'your property',
    });
    await this.audit.log({
      actorId: agentUserId,
      action: 'assignment.publish',
      entityType: 'property',
      entityId: property.id,
      after: { askGbp: ask, platformProfitGbp: profit, agentCommissionGbp: commissionGbp, listPriceGbp: listPrice },
      ip,
    });
    return { propertyId: property.id, status: updated.status, listPriceGbp: listPrice, platformProfitGbp: profit };
  }

  /** Main-admin board: every mediated resale with the money breakdown (§13.5). */
  async mediatedListings() {
    const props = await this.prisma.property.findMany({
      where: { kind: 'resale', status: { in: ['verified_private', 'live', 'under_offer', 'sold'] }, deletedAt: null },
      select: {
        id: true, titleI18n: true, status: true, priceBaseGbp: true,
        platformProfitGbp: true, agentCommissionGbp: true, listPriceGbp: true,
        publishedByAgentId: true, createdAt: true,
        createdBy: { select: { id: true, email: true, phone: true } },
        region: { select: { slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const assignments = await this.prisma.agentAssignment.findMany({
      where: { propertyId: { in: props.map((p) => p.id) } },
    });
    return props.map((p) => ({
      ...p,
      assignments: assignments.filter((a) => a.propertyId === p.id),
    }));
  }

  /** Agent's own published listings with their commission (§13.5). */
  async myPublished(agentUserId: string) {
    return this.prisma.property.findMany({
      where: { publishedByAgentId: agentUserId, deletedAt: null },
      select: {
        id: true, titleI18n: true, status: true,
        agentCommissionGbp: true, listPriceGbp: true, viewCount: true, saveCount: true,
        region: { select: { slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Daily via the BullMQ `maintenance` queue: expire elapsed assignment rounds. */
  async expireSweep() {
    const { count } = await this.prisma.agentAssignment.updateMany({
      where: { status: { in: ['invited', 'accepted'] }, expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });
    return { expired: count };
  }
}
