import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReputationService } from '../deals/reputation.service';

/** Rolling window for the "recent" half of every funnel. */
const WINDOW_DAYS = 30;

export interface Funnel {
  views: number;
  viewsRecent: number;
  inquiries: number;
  viewings: number;
  viewingsCompleted: number;
  offers: number;
  deals: number;
  dealsCompleted: number;
}

/**
 * Professional analytics (Plan §6.7, §13.1 "org-wide analytics").
 *
 * Everything here is scoped to what the caller actually owns: an agency sees
 * its own account plus its active members, a developer sees its projects, an
 * owner sees their listings. No endpoint takes a subject id — the scope is
 * derived from the token, so there is nothing to tamper with.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reputation: ReputationService,
  ) {}

  private since(days = WINDOW_DAYS) {
    return new Date(Date.now() - days * 86_400_000);
  }

  /** The user ids whose performance rolls up to this caller. */
  private async scopeUserIds(userId: string): Promise<{ ids: string[]; agencyId: string | null }> {
    const agency = await this.prisma.agencyProfile.findUnique({ where: { userId } });
    if (agency) {
      const members = await this.prisma.agencyAgent.findMany({
        where: { agencyId: userId, status: 'active' },
        select: { agentUserId: true },
      });
      return { ids: [userId, ...members.map((m) => m.agentUserId)], agencyId: userId };
    }
    // a member sees only themselves; org-wide numbers belong to the org admin
    return { ids: [userId], agencyId: null };
  }

  /** Listing funnel for a set of listers: view → inquiry → viewing → offer → deal. */
  private async funnelFor(userIds: string[]): Promise<Funnel & { propertyIds: string[] }> {
    const properties = await this.prisma.property.findMany({
      where: {
        deletedAt: null,
        OR: [
          { createdByUserId: { in: userIds } },
          { publishedByAgentId: { in: userIds } },
          { onBehalfOfOwnerId: { in: userIds } },
        ],
      },
      select: { id: true, viewCount: true },
    });
    const propertyIds = properties.map((p) => p.id);
    const empty = {
      views: 0, viewsRecent: 0, inquiries: 0, viewings: 0,
      viewingsCompleted: 0, offers: 0, deals: 0, dealsCompleted: 0,
    };
    if (propertyIds.length === 0) return { ...empty, propertyIds };

    const [viewsRecent, inquiries, viewings, viewingsCompleted, offers, deals, dealsCompleted] =
      await Promise.all([
        this.prisma.propertyViewEvent.count({
          where: { propertyId: { in: propertyIds }, createdAt: { gte: this.since() } },
        }),
        // A lead is a conversation a CUSTOMER opened. The owner↔agent
        // mediation channel (§13.4) and deal rooms are also property
        // conversations, and counting them would inflate every funnel above it.
        this.prisma.conversation.count({
          where: {
            propertyId: { in: propertyIds },
            dealId: null,
            participants: { some: { roleInConvo: 'customer' } },
          },
        }),
        this.prisma.viewing.count({ where: { propertyId: { in: propertyIds } } }),
        this.prisma.viewing.count({
          where: { propertyId: { in: propertyIds }, status: 'completed' },
        }),
        this.prisma.offer.count({ where: { propertyId: { in: propertyIds } } }),
        this.prisma.deal.count({ where: { propertyId: { in: propertyIds } } }),
        this.prisma.deal.count({
          where: { propertyId: { in: propertyIds }, status: 'completed' },
        }),
      ]);

    return {
      views: properties.reduce((n, p) => n + p.viewCount, 0),
      viewsRecent,
      inquiries,
      viewings,
      viewingsCompleted,
      offers,
      deals,
      dealsCompleted,
      propertyIds,
    };
  }

  private async listingsByStatus(userIds: string[]) {
    const rows = await this.prisma.property.groupBy({
      by: ['status'],
      where: {
        deletedAt: null,
        OR: [{ createdByUserId: { in: userIds } }, { publishedByAgentId: { in: userIds } }],
      },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  /** Closed deals split by kind, counted once per deal per user. */
  private async closedFor(userIds: string[]) {
    const parties = await this.prisma.dealParty.findMany({
      where: { userId: { in: userIds }, deal: { status: 'completed' } },
      select: { userId: true, dealId: true, deal: { select: { kind: true } } },
    });
    const seen = new Set<string>();
    let sales = 0;
    let rentals = 0;
    for (const p of parties) {
      const key = `${p.userId}:${p.dealId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.deal.kind === 'rental') rentals++;
      else sales++;
    }
    return { salesClosed: sales, rentalsClosed: rentals };
  }

  /** Per-member rollup for an agency org admin (§13.1 org-wide analytics). */
  private async memberBreakdown(agencyId: string) {
    const members = await this.prisma.agencyAgent.findMany({
      where: { agencyId, status: 'active' },
      select: {
        agentUserId: true,
        orgRole: true,
        agent: {
          select: {
            phone: true,
            agentProfile: {
              select: { rankingScore: true, ratingAvg: true, responseTimeAvgSec: true, dealCount: true },
            },
          },
        },
      },
    });

    return Promise.all(
      members.map(async (m) => ({
        userId: m.agentUserId,
        phone: m.agent.phone,
        orgRole: m.orgRole,
        rankingScore: m.agent.agentProfile?.rankingScore ?? null,
        ratingAvg: m.agent.agentProfile?.ratingAvg ?? null,
        responseTimeAvgSec: m.agent.agentProfile?.responseTimeAvgSec ?? null,
        ...(await this.closedFor([m.agentUserId])),
        listings: await this.prisma.property.count({
          where: {
            deletedAt: null,
            OR: [{ createdByUserId: m.agentUserId }, { publishedByAgentId: m.agentUserId }],
          },
        }),
      })),
    );
  }

  /** Developer inventory + lead performance, per project. */
  private async projectStats(developerUserId: string) {
    const projects = await this.prisma.project.findMany({
      where: { developerUserId, deletedAt: null },
      select: {
        id: true, nameI18n: true, status: true, createdAt: true,
        region: { select: { slug: true, nameI18n: true } },
        units: { select: { status: true, priceAmount: true, areaM2: true } },
        _count: { select: { conversations: true, updates: true } },
      },
    });

    return Promise.all(
      projects.map(async (p) => {
        const units = p.units;
        const sold = units.filter((u) => u.status === 'sold').length;
        const reserved = units.filter((u) => u.status === 'reserved').length;
        const withArea = units.filter((u) => u.areaM2 && u.areaM2 > 0);
        const avgPricePerM2 = withArea.length
          ? Math.round(
              withArea.reduce((s, u) => s + Number(u.priceAmount) / (u.areaM2 as number), 0) /
                withArea.length,
            )
          : null;

        return {
          projectId: p.id,
          name: (p.nameI18n as { en?: string })?.en ?? '',
          status: p.status,
          regionSlug: p.region.slug,
          units: {
            total: units.length,
            available: units.length - sold - reserved,
            reserved,
            sold,
          },
          /** Share of inventory taken — the number a developer actually steers on. */
          absorptionRate: units.length ? Math.round(((sold + reserved) / units.length) * 100) : 0,
          avgPricePerM2,
          soldValue: units
            .filter((u) => u.status === 'sold')
            .reduce((s, u) => s + Number(u.priceAmount), 0),
          leads: p._count.conversations,
          updatesPosted: p._count.updates,
          reservations: await this.prisma.deal.count({
            where: { projectUnit: { projectId: p.id } },
          }),
        };
      }),
    );
  }

  /**
   * §13.1(b) developer project comparison — within a region and across regions.
   *
   * Benchmarks are computed over LIVE projects only and reported as aggregates
   * (median price/m², mean absorption). Nothing here names a competitor's
   * project: a developer sees where they sit, not who else is in the market.
   */
  async projectComparison(developerUserId: string) {
    const live = await this.prisma.project.findMany({
      where: { status: 'live', deletedAt: null },
      select: {
        id: true,
        developerUserId: true,
        region: { select: { slug: true } },
        units: { select: { status: true, priceAmount: true, areaM2: true } },
      },
    });

    const perProject = live.map((p) => {
      const withArea = p.units.filter((u) => u.areaM2 && u.areaM2 > 0);
      const taken = p.units.filter((u) => u.status !== 'available').length;
      return {
        regionSlug: p.region.slug,
        mine: p.developerUserId === developerUserId,
        pricePerM2: withArea.length
          ? withArea.reduce((s, u) => s + Number(u.priceAmount) / (u.areaM2 as number), 0) /
            withArea.length
          : null,
        absorption: p.units.length ? (taken / p.units.length) * 100 : null,
        units: p.units.length,
      };
    });

    const median = (xs: number[]) => {
      if (xs.length === 0) return null;
      const s = [...xs].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const summarise = (rows: typeof perProject) => ({
      projects: rows.length,
      units: rows.reduce((n, r) => n + r.units, 0),
      medianPricePerM2: median(rows.map((r) => r.pricePerM2).filter((v): v is number => v !== null)),
      avgAbsorption: rows.length
        ? Math.round(
            rows.reduce((s, r) => s + (r.absorption ?? 0), 0) / rows.length,
          )
        : null,
    });

    const regions = [...new Set(perProject.filter((r) => r.mine).map((r) => r.regionSlug))];
    return {
      /** How this developer compares inside each region they build in. */
      byRegion: regions.map((slug) => ({
        regionSlug: slug,
        mine: summarise(perProject.filter((r) => r.mine && r.regionSlug === slug)),
        market: summarise(perProject.filter((r) => r.regionSlug === slug)),
      })),
      /** …and against the whole TRNC market. */
      overall: {
        mine: summarise(perProject.filter((r) => r.mine)),
        market: summarise(perProject),
      },
    };
  }

  /**
   * The caller's own dashboard. Role-aware by composition rather than
   * branching on a role string: each block is included when the caller has the
   * data behind it, so a user who is both an agent and an owner sees both.
   */
  async myDashboard(userId: string) {
    const { ids, agencyId } = await this.scopeUserIds(userId);

    const [funnel, listings, closed, reputation, developerProfile] = await Promise.all([
      this.funnelFor(ids),
      this.listingsByStatus(ids),
      this.closedFor(ids),
      this.reputation.breakdownFor(userId),
      this.prisma.developerProfile.findUnique({ where: { userId } }),
    ]);
    const { propertyIds, ...funnelCounts } = funnel;

    return {
      scope: {
        userIds: ids,
        isOrg: Boolean(agencyId),
        windowDays: WINDOW_DAYS,
      },
      listings,
      funnel: {
        ...funnelCounts,
        // conversion is the point of a funnel; compute it once, server-side,
        // so every client (web today, mobile in Phase 2) reports the same number
        inquiryRate: funnelCounts.views ? +(funnelCounts.inquiries / funnelCounts.views * 100).toFixed(1) : 0,
        viewingRate: funnelCounts.inquiries ? +(funnelCounts.viewings / funnelCounts.inquiries * 100).toFixed(1) : 0,
        offerRate: funnelCounts.viewings ? +(funnelCounts.offers / funnelCounts.viewings * 100).toFixed(1) : 0,
        closeRate: funnelCounts.offers ? +(funnelCounts.dealsCompleted / funnelCounts.offers * 100).toFixed(1) : 0,
      },
      deals: closed,
      reputation,
      ...(agencyId ? { members: await this.memberBreakdown(agencyId) } : {}),
      ...(developerProfile
        ? {
            projects: await this.projectStats(userId),
            comparison: await this.projectComparison(userId),
          }
        : {}),
    };
  }

  /**
   * Platform-wide admin analytics (§6.7): supply/demand by region, the market
   * funnel, and verification SLA performance.
   */
  async adminOverview() {
    const since = this.since();

    const [byRegion, listingsByStatus, verification, funnel] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['regionId', 'status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.property.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.verificationItem.findMany({
        where: { decidedAt: { not: null } },
        select: { createdAt: true, decidedAt: true, slaDueAt: true, status: true },
        take: 500,
        orderBy: { decidedAt: 'desc' },
      }),
      Promise.all([
        this.prisma.propertyViewEvent.count({ where: { createdAt: { gte: since } } }),
        this.prisma.conversation.count({
          where: {
            createdAt: { gte: since },
            dealId: null,
            participants: { some: { roleInConvo: 'customer' } },
          },
        }),
        this.prisma.viewing.count({ where: { createdAt: { gte: since } } }),
        this.prisma.offer.count({ where: { createdAt: { gte: since } } }),
        this.prisma.deal.count({ where: { createdAt: { gte: since } } }),
        this.prisma.deal.count({ where: { completedAt: { gte: since } } }),
      ]),
    ]);

    const regions = await this.prisma.region.findMany({ select: { id: true, slug: true } });
    const regionSlug = Object.fromEntries(regions.map((r) => [r.id, r.slug]));

    const supply: Record<string, Record<string, number>> = {};
    for (const row of byRegion) {
      const slug = regionSlug[row.regionId] ?? row.regionId;
      supply[slug] ??= {};
      supply[slug][row.status] = row._count._all;
    }

    const turnarounds = verification.map(
      (v) => (v.decidedAt!.getTime() - v.createdAt.getTime()) / 3_600_000,
    );
    const withinSla = verification.filter((v) => v.decidedAt! <= v.slaDueAt).length;

    const [views, inquiries, viewings, offers, deals, dealsCompleted] = funnel;
    return {
      windowDays: WINDOW_DAYS,
      supplyByRegion: supply,
      listingsByStatus: Object.fromEntries(listingsByStatus.map((r) => [r.status, r._count._all])),
      funnel: { views, inquiries, viewings, offers, deals, dealsCompleted },
      verification: {
        decided: verification.length,
        avgTurnaroundHours: turnarounds.length
          ? +(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length).toFixed(1)
          : null,
        withinSlaPct: verification.length
          ? Math.round((withinSla / verification.length) * 100)
          : null,
        approvalRatePct: verification.length
          ? Math.round(
              (verification.filter((v) => v.status === 'approved').length / verification.length) * 100,
            )
          : null,
      },
    };
  }
}
