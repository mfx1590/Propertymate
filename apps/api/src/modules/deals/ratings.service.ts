import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RATING_REVEAL_DAYS } from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const RATING_TAGS = ['responsive', 'honest', 'smooth_process', 'knowledgeable', 'punctual', 'professional'];

/**
 * Post-completion counterparty ratings (§6.5). Interaction-gated by deal
 * membership (§13.2). Both-submit-or-14-days reveal prevents retaliation.
 */
@Injectable()
export class RatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Who this user may rate on a completed deal (the other parties). */
  async rateableParties(userId: string, dealId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { parties: { include: { user: { select: { id: true } } } } },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.status !== 'completed') return [];
    if (!deal.parties.some((p) => p.userId === userId)) throw new ForbiddenException('Not a party to this deal');

    const mine = await this.prisma.rating.findMany({ where: { dealId, raterId: userId }, select: { rateeId: true } });
    const rated = new Set(mine.map((r) => r.rateeId));
    const others = [...new Set(deal.parties.filter((p) => p.userId !== userId).map((p) => p.userId))];
    return others.map((uid) => ({ userId: uid, alreadyRated: rated.has(uid) }));
  }

  async submit(
    raterId: string,
    dealId: string,
    rateeId: string,
    stars: number,
    tags: string[],
    comment: string | undefined,
    ip?: string,
  ) {
    if (!(stars >= 1 && stars <= 5)) throw new BadRequestException('Stars must be 1–5');
    const cleanTags = (tags ?? []).filter((t) => RATING_TAGS.includes(t));

    const deal = await this.prisma.deal.findUnique({ where: { id: dealId }, include: { parties: true } });
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.status !== 'completed') throw new BadRequestException('Ratings unlock after the deal completes');
    if (!deal.parties.some((p) => p.userId === raterId)) throw new ForbiddenException('Not a party to this deal');
    if (!deal.parties.some((p) => p.userId === rateeId) || rateeId === raterId) {
      throw new BadRequestException('You can only rate the other party');
    }

    const rating = await this.prisma.rating.upsert({
      where: { dealId_raterId_rateeId: { dealId, raterId, rateeId } },
      update: { stars, tags: cleanTags, comment },
      create: { dealId, raterId, rateeId, stars, tags: cleanTags, comment },
    });

    // reveal both directions once the counterpart has also rated (§6.5)
    let revealed = Boolean(rating.revealedAt);
    const reciprocal = await this.prisma.rating.findUnique({
      where: { dealId_raterId_rateeId: { dealId, raterId: rateeId, rateeId: raterId } },
    });
    if (reciprocal) {
      const now = new Date();
      await this.prisma.rating.updateMany({
        where: { id: { in: [rating.id, reciprocal.id] }, revealedAt: null },
        data: { revealedAt: now },
      });
      await this.recomputeReputation(rateeId);
      await this.recomputeReputation(raterId);
      revealed = true;
    }

    await this.audit.log({
      actorId: raterId,
      action: 'rating.submit',
      entityType: 'rating',
      entityId: rating.id,
      after: { dealId, rateeId, stars },
      ip,
    });
    return { id: rating.id, revealed };
  }

  /** Public reviews on a profile — only revealed ones, reviewer identity withheld (§6.5, §13.2). */
  async publicReviews(rateeId: string) {
    const rows = await this.prisma.rating.findMany({
      where: { rateeId, revealedAt: { not: null } },
      select: { stars: true, tags: true, comment: true, revealedAt: true },
      orderBy: { revealedAt: 'desc' },
      take: 50,
    });
    const avg = rows.length ? rows.reduce((s, r) => s + r.stars, 0) / rows.length : null;
    return { count: rows.length, avgStars: avg, reviews: rows };
  }

  /** Daily via the BullMQ `maintenance` queue: reveal ratings older than 14 days
   *  even if the counterpart never rated. */
  async revealStale() {
    const cutoff = new Date(Date.now() - RATING_REVEAL_DAYS * 86_400_000);
    const stale = await this.prisma.rating.findMany({
      where: { revealedAt: null, createdAt: { lt: cutoff } },
      select: { id: true, rateeId: true },
    });
    if (stale.length === 0) return { revealed: 0 };
    await this.prisma.rating.updateMany({
      where: { id: { in: stale.map((r) => r.id) } },
      data: { revealedAt: new Date() },
    });
    for (const rateeId of new Set(stale.map((r) => r.rateeId))) {
      await this.recomputeReputation(rateeId);
    }
    return { revealed: stale.length };
  }

  /** Roll revealed ratings + completed-deal counts into agent_profiles (§6.5). */
  private async recomputeReputation(userId: string) {
    const agent = await this.prisma.agentProfile.findUnique({ where: { userId } });
    if (!agent) return; // only professional profiles carry a public score

    const revealed = await this.prisma.rating.findMany({
      where: { rateeId: userId, revealedAt: { not: null } },
      select: { stars: true },
    });
    const ratingAvg = revealed.length ? revealed.reduce((s, r) => s + r.stars, 0) / revealed.length : null;
    const dealCount = await this.prisma.deal.count({
      where: { status: 'completed', parties: { some: { userId } } },
    });
    await this.prisma.agentProfile.update({
      where: { userId },
      data: { ratingAvg, dealCount },
    });
  }

  static readonly TAGS = RATING_TAGS;
}
