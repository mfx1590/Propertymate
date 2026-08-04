import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  RANKING_DEALS_SATURATION,
  RANKING_RATING_PRIOR,
  RANKING_RATING_PRIOR_WEIGHT,
  RANKING_RESPONSE_TARGET_SEC,
  RANKING_UNKNOWN_FACTOR,
  RANKING_WEIGHTS,
  TRUSTED_PARTNER_MIN_DEALS,
  TRUSTED_PARTNER_MIN_RATING,
  type RankingBreakdown,
} from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** How far back response-time sampling looks — recent behaviour is what matters. */
const RESPONSE_WINDOW_DAYS = 90;
/** Upheld disputes only count against a pro for this long (Plan §3 badge rule). */
const DISPUTE_WINDOW_DAYS = 365;

interface ReputationInputs {
  ratingAvg: number | null;
  ratingCount: number;
  dealCount: number;
  responseTimeAvgSec: number | null;
  disputeRate: number | null;
  upheldDisputes: number;
}

/**
 * Agent reputation & ranking (Plan §6.5, §8).
 *
 * The score is `f(rating_avg, deal_count, response_time, dispute_rate)` — each
 * factor normalised to 0–1, then weighted (weights in `@propverify/shared` so
 * the dashboard explains exactly what it scores on). Recomputed nightly and on
 * every rating reveal; publishing a new score emits `reputation.updated` so the
 * search index picks up the boost without this module knowing Meilisearch exists.
 *
 * Also runs the Plan §3 `trusted_partner` badge rule, which shares these inputs.
 */
@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Pure scoring — exported shape doubles as the dashboard's explanation. */
  static score(inputs: ReputationInputs): RankingBreakdown {
    // Bayesian mean: few ratings stay near the prior, so a single 5★ deal
    // cannot outrank a long honest record.
    const ratingScore =
      inputs.ratingCount > 0 && inputs.ratingAvg !== null
        ? (inputs.ratingAvg * inputs.ratingCount + RANKING_RATING_PRIOR * RANKING_RATING_PRIOR_WEIGHT) /
          ((inputs.ratingCount + RANKING_RATING_PRIOR_WEIGHT) * 5)
        : RANKING_RATING_PRIOR / 5;

    const dealsScore = Math.min(1, inputs.dealCount / RANKING_DEALS_SATURATION);

    const responseScore =
      inputs.responseTimeAvgSec === null
        ? RANKING_UNKNOWN_FACTOR
        : Math.max(0, 1 - inputs.responseTimeAvgSec / RANKING_RESPONSE_TARGET_SEC);

    // No deals yet ⇒ no dispute history to hold against anyone.
    const disputeFreeScore = inputs.disputeRate === null ? 1 : Math.max(0, 1 - inputs.disputeRate);

    const factors = {
      rating: { value: inputs.ratingAvg, score: ratingScore, weight: RANKING_WEIGHTS.rating },
      deals: { value: inputs.dealCount, score: dealsScore, weight: RANKING_WEIGHTS.deals },
      responseTime: {
        value: inputs.responseTimeAvgSec,
        score: responseScore,
        weight: RANKING_WEIGHTS.responseTime,
      },
      disputeFree: {
        value: inputs.disputeRate,
        score: disputeFreeScore,
        weight: RANKING_WEIGHTS.disputeFree,
      },
    };

    const total = Object.values(factors).reduce((sum, f) => sum + f.score * f.weight, 0);
    return { factors, score: Math.round(total * 10) / 10 };
  }

  /**
   * Average seconds between an inbound message and this user's first reply.
   *
   * Only the first reply per inbound burst counts: a customer sending three
   * messages in a row is one thing to answer, not three.
   */
  async responseTimeFor(userId: string): Promise<number | null> {
    const since = new Date(Date.now() - RESPONSE_WINDOW_DAYS * 86_400_000);
    const conversationIds = (
      await this.prisma.conversationParticipant.findMany({
        where: { userId },
        select: { conversationId: true },
      })
    ).map((c) => c.conversationId);
    if (conversationIds.length === 0) return null;

    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: conversationIds }, createdAt: { gte: since } },
      select: { conversationId: true, senderId: true, createdAt: true },
      orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
    });

    let total = 0;
    let samples = 0;
    let currentConversation: string | null = null;
    let awaitingSince: Date | null = null;

    for (const m of messages) {
      if (m.conversationId !== currentConversation) {
        currentConversation = m.conversationId;
        awaitingSince = null;
      }
      if (m.senderId === userId) {
        if (awaitingSince) {
          total += (m.createdAt.getTime() - awaitingSince.getTime()) / 1000;
          samples++;
          awaitingSince = null;
        }
      } else if (!awaitingSince) {
        awaitingSince = m.createdAt;
      }
    }

    return samples > 0 ? Math.round(total / samples) : null;
  }

  private async gather(userId: string): Promise<ReputationInputs> {
    const [revealed, dealCount, responseTimeAvgSec, upheldDisputes] = await Promise.all([
      this.prisma.rating.findMany({
        where: { rateeId: userId, revealedAt: { not: null } },
        select: { stars: true },
      }),
      this.prisma.deal.count({ where: { status: 'completed', parties: { some: { userId } } } }),
      this.responseTimeFor(userId),
      this.prisma.dispute.count({
        where: {
          againstUserId: userId,
          status: 'resolved_upheld',
          createdAt: { gte: new Date(Date.now() - DISPUTE_WINDOW_DAYS * 86_400_000) },
        },
      }),
    ]);

    const ratingAvg = revealed.length
      ? revealed.reduce((s, r) => s + r.stars, 0) / revealed.length
      : null;

    return {
      ratingAvg,
      ratingCount: revealed.length,
      dealCount,
      responseTimeAvgSec,
      disputeRate: dealCount > 0 ? upheldDisputes / dealCount : null,
      upheldDisputes,
    };
  }

  /**
   * Recomputes one professional's reputation. No-ops for users without an
   * `agent_profiles` row — only professional profiles carry a public score.
   */
  async recompute(userId: string): Promise<(RankingBreakdown & { inputs: ReputationInputs }) | null> {
    const profile = await this.prisma.agentProfile.findUnique({ where: { userId } });
    if (!profile) return null;

    const inputs = await this.gather(userId);
    const breakdown = ReputationService.score(inputs);

    await this.prisma.agentProfile.update({
      where: { userId },
      data: {
        ratingAvg: inputs.ratingAvg,
        dealCount: inputs.dealCount,
        responseTimeAvgSec: inputs.responseTimeAvgSec,
        disputeRate: inputs.disputeRate,
        rankingScore: breakdown.score,
        rankingComputedAt: new Date(),
      },
    });

    await this.applyBadgeTier(userId, inputs);

    // Search owns the index; it listens for this and re-syncs the lister's
    // live listings so the boost lands without a cross-module import.
    this.events.emit('reputation.updated', { userId, score: breakdown.score });

    return { ...breakdown, inputs };
  }

  /**
   * Plan §3 badge rule: ≥5 completed deals AND avg rating ≥4.5 AND zero upheld
   * disputes in 12 months. Reversible — a pro who slips loses the tier at the
   * next run, so the badge always reflects current standing.
   */
  private async applyBadgeTier(userId: string, inputs: ReputationInputs) {
    const earned =
      inputs.dealCount >= TRUSTED_PARTNER_MIN_DEALS &&
      (inputs.ratingAvg ?? 0) >= TRUSTED_PARTNER_MIN_RATING &&
      inputs.upheldDisputes === 0;

    // Only verified professional assignments are eligible; customer baseline
    // roles and pending applications are left alone.
    const assignments = await this.prisma.userRole.findMany({
      where: {
        userId,
        verificationStatus: 'verified',
        role: { key: { in: ['solo_agent', 'agency', 'agency_member'] } },
      },
      select: { id: true, badgeTier: true },
    });

    for (const a of assignments) {
      const target = earned ? 'trusted_partner' : 'verified';
      if (a.badgeTier === target) continue;
      // never demote out of a tier we do not own (e.g. a manual admin grant)
      if (!earned && a.badgeTier !== 'trusted_partner') continue;
      await this.prisma.userRole.update({ where: { id: a.id }, data: { badgeTier: target } });
    }
  }

  /**
   * A completed deal moves `deal_count` (and the trusted_partner threshold)
   * for every party, with or without ratings — so score them all now.
   */
  @OnEvent('deal.completed')
  async onDealCompleted({ dealId }: { dealId: string }) {
    const parties = await this.prisma.dealParty.findMany({
      where: { dealId },
      select: { userId: true },
    });
    for (const userId of new Set(parties.map((p) => p.userId))) {
      await this.recompute(userId).catch((err) =>
        this.logger.error(`Reputation recompute failed for ${userId}: ${err}`),
      );
    }
  }

  /**
   * Nightly sweep over every professional profile (BullMQ `maintenance` queue).
   * Sequential by design: this runs at 02:00 and correctness beats speed.
   */
  async recomputeAll(): Promise<{ scored: number }> {
    const profiles = await this.prisma.agentProfile.findMany({ select: { userId: true } });
    let scored = 0;
    for (const { userId } of profiles) {
      try {
        await this.recompute(userId);
        scored++;
      } catch (err) {
        this.logger.error(`Reputation recompute failed for ${userId}: ${err}`);
      }
    }
    this.logger.log(`Reputation recomputed for ${scored}/${profiles.length} professionals`);
    return { scored };
  }

  /** Score breakdown for the owning pro's analytics dashboard. */
  async breakdownFor(userId: string) {
    const profile = await this.prisma.agentProfile.findUnique({ where: { userId } });
    if (!profile) return null;
    const inputs = await this.gather(userId);
    const breakdown = ReputationService.score(inputs);
    return {
      ...breakdown,
      storedScore: profile.rankingScore,
      computedAt: profile.rankingComputedAt,
    };
  }
}
