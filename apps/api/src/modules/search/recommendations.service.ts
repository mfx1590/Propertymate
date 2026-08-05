import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** How far back co-visitation looks. Older browsing says little about today. */
const WINDOW_DAYS = 90;
/** Stored per property — enough for a "you may also like" strip with headroom. */
const TOP_N = 12;
/** One session touching this many listings is a crawler or a bored browser. */
const MAX_VIEWS_PER_SESSION = 40;
/** Below this, a pair is coincidence rather than signal. */
const MIN_CO_VIEWS = 2;

/**
 * Recommendation v1 (Plan §8): "viewers of X also viewed Y", from a nightly
 * batch over `property_view_events`.
 *
 * Scored by cosine over distinct viewers — `co / sqrt(|A| * |B|)` — rather than
 * raw co-view counts, so a popular listing does not end up recommended
 * everywhere purely for being popular.
 *
 * v2 (collaborative filtering) replaces the scoring; the table, the job and the
 * public endpoint stay as they are.
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nightly rebuild. Held in memory on purpose: at TRNC scale this is tens of
   * thousands of rows, and a single pass beats N² round trips to Postgres.
   */
  async rebuild(): Promise<{ properties: number; pairs: number }> {
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const events = await this.prisma.propertyViewEvent.findMany({
      where: { createdAt: { gte: since } },
      select: { propertyId: true, viewerId: true, sessionKey: true },
    });

    // A signed-in viewer is the strongest identity; the browser session covers
    // everyone else. Events with neither cannot be attributed to a person and
    // are dropped — counting them would invent co-visits between strangers.
    const byViewer = new Map<string, Set<string>>();
    for (const e of events) {
      const identity = e.viewerId ?? e.sessionKey;
      if (!identity) continue;
      let seen = byViewer.get(identity);
      if (!seen) byViewer.set(identity, (seen = new Set()));
      seen.add(e.propertyId);
    }

    const viewerCount = new Map<string, number>();
    const pairCount = new Map<string, number>();

    for (const seen of byViewer.values()) {
      const ids = [...seen];
      if (ids.length < 2 || ids.length > MAX_VIEWS_PER_SESSION) {
        // a single view carries no pair; a huge session is a crawler
        for (const id of ids) viewerCount.set(id, (viewerCount.get(id) ?? 0) + 1);
        continue;
      }
      for (const id of ids) viewerCount.set(id, (viewerCount.get(id) ?? 0) + 1);
      ids.sort();
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const key = `${ids[i]}|${ids[j]}`;
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    }

    // score both directions: A→B and B→A share a co-view count but differ in
    // denominator only through the pair, so the cosine is symmetric here
    const ranked = new Map<string, { recommendedId: string; score: number; coViews: number }[]>();
    for (const [key, co] of pairCount) {
      if (co < MIN_CO_VIEWS) continue;
      const [a, b] = key.split('|');
      const score = co / Math.sqrt((viewerCount.get(a) ?? 1) * (viewerCount.get(b) ?? 1));
      for (const [from, to] of [
        [a, b],
        [b, a],
      ]) {
        const list = ranked.get(from) ?? [];
        list.push({ recommendedId: to, score, coViews: co });
        ranked.set(from, list);
      }
    }

    // Only live listings are worth recommending — a sold or paused one is a
    // dead end for the visitor.
    const live = new Set(
      (
        await this.prisma.property.findMany({
          where: { status: 'live', deletedAt: null },
          select: { id: true },
        })
      ).map((p) => p.id),
    );

    const rows: {
      propertyId: string;
      recommendedId: string;
      score: number;
      coViews: number;
      rank: number;
    }[] = [];
    for (const [propertyId, list] of ranked) {
      if (!live.has(propertyId)) continue;
      list
        .filter((r) => live.has(r.recommendedId))
        .sort((x, y) => y.score - x.score || y.coViews - x.coViews)
        .slice(0, TOP_N)
        .forEach((r, i) => {
          rows.push({ propertyId, recommendedId: r.recommendedId, score: r.score, coViews: r.coViews, rank: i + 1 });
        });
    }

    // Replace wholesale in one transaction: a half-rebuilt table would serve a
    // mix of today's and last week's rankings.
    await this.prisma.$transaction([
      this.prisma.propertyRecommendation.deleteMany({}),
      ...(rows.length
        ? [this.prisma.propertyRecommendation.createMany({ data: rows, skipDuplicates: true })]
        : []),
    ]);

    const properties = new Set(rows.map((r) => r.propertyId)).size;
    this.logger.log(
      `Recommendations rebuilt: ${rows.length} pairs across ${properties} properties from ${byViewer.size} viewers`,
    );
    return { properties, pairs: rows.length };
  }

  /**
   * Similar listings for the public detail page.
   *
   * Falls back to content similarity when co-visitation has nothing: a listing
   * published this morning has no view history, and showing an empty strip on
   * every new listing would be worse than showing comparable ones.
   */
  async similarTo(propertyId: string, limit = 6) {
    const source = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, kind: true, regionId: true, bedrooms: true, priceBaseGbp: true, listPriceGbp: true },
    });
    if (!source) return { source: 'none' as const, items: [] };

    const covisited = await this.prisma.propertyRecommendation.findMany({
      where: { propertyId, recommended: { status: 'live', deletedAt: null } },
      orderBy: { rank: 'asc' },
      take: limit,
      select: {
        score: true,
        coViews: true,
        recommended: {
          select: {
            id: true, titleI18n: true, kind: true, bedrooms: true, bathrooms: true, areaM2: true,
            priceBaseGbp: true, listPriceGbp: true, priceCurrency: true,
            region: { select: { slug: true, nameI18n: true } },
            media: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
          },
        },
      },
    });

    if (covisited.length > 0) {
      return {
        source: 'co_visitation' as const,
        items: covisited.map((r) => this.shape(r.recommended, { score: r.score, coViews: r.coViews })),
      };
    }

    const price = Number(source.listPriceGbp ?? source.priceBaseGbp);
    const fallback = await this.prisma.property.findMany({
      where: {
        id: { not: propertyId },
        status: 'live',
        deletedAt: null,
        kind: source.kind,
        regionId: source.regionId,
        ...(source.bedrooms !== null ? { bedrooms: source.bedrooms } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit * 3,
      select: {
        id: true, titleI18n: true, kind: true, bedrooms: true, bathrooms: true, areaM2: true,
        priceBaseGbp: true, listPriceGbp: true, priceCurrency: true,
        region: { select: { slug: true, nameI18n: true } },
        media: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
      },
    });

    // nearest by price within the same region/kind/bedrooms
    const items = fallback
      .map((p) => ({ p, delta: Math.abs(Number(p.listPriceGbp ?? p.priceBaseGbp) - price) }))
      .sort((a, b) => a.delta - b.delta)
      .slice(0, limit)
      .map(({ p }) => this.shape(p, null));

    return { source: 'similar_listing' as const, items };
  }

  /** §13.5: the public payload carries the final price only, never the breakdown. */
  private shape(
    p: {
      id: string; titleI18n: unknown; kind: string; bedrooms: number | null; bathrooms: number | null;
      areaM2: number | null; priceBaseGbp: unknown; listPriceGbp: unknown; priceCurrency: string;
      region: { slug: string; nameI18n: unknown };
      media: { url: string }[];
    },
    signal: { score: number; coViews: number } | null,
  ) {
    return {
      id: p.id,
      title: (p.titleI18n as { en?: string })?.en ?? '',
      kind: p.kind,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      areaM2: p.areaM2,
      priceGbp: Number(p.listPriceGbp ?? p.priceBaseGbp),
      priceCurrency: p.listPriceGbp ? 'GBP' : p.priceCurrency,
      regionSlug: p.region.slug,
      regionName: (p.region.nameI18n as { en?: string })?.en ?? p.region.slug,
      coverUrl: p.media[0]?.url ?? null,
      ...(signal ? { score: Math.round(signal.score * 1000) / 1000, coViews: signal.coViews } : {}),
    };
  }
}
