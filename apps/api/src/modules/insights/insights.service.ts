import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  cleanSorted,
  median,
  percentile,
  perM2Values,
  publicPriceGbp,
} from '../../common/market-stats';

/** Statuses a member of the public can see — same rule as the region pages. */
const PUBLIC_STATUSES = ['live'] as const;

/**
 * Below this many comparables an estimate is a guess wearing a number, so the
 * endpoint says "not enough like it" instead of inventing one. Five matches
 * the region pages' rule for suppressing the deed-type breakdown.
 */
const MIN_COMPARABLES = 5;

/** How many months of history one page load gets. */
const SERIES_MONTHS = 12;

const monthStartUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const nextMonthUtc = (m: Date) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));

/**
 * Market insights + valuation v1 (Plan §6.1 "monthly market-insights pages",
 * §10.2 Phase 3).
 *
 * Every number here is derived from asking prices and traffic ON THIS
 * PLATFORM. That is a real, useful dataset — it is also not "the TRNC market",
 * and both the API shape and the pages that render it say so rather than
 * letting a median asking price masquerade as a sold price. Actual transaction
 * prices exist in deal snapshots but are far too few to aggregate honestly
 * yet; when they are, they join as a separate, labelled series — never blended
 * into asking figures.
 */
@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── monthly snapshots ────────────────────────────────────────────

  /** The scheduled entry point: on the 1st, finalise the month just ended. */
  runSnapshotForPreviousMonth() {
    const thisMonth = monthStartUtc(new Date());
    return this.runSnapshot(new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 1)));
  }

  /**
   * Compute one region-month row per region and upsert it.
   *
   * Defaults to the current month, which is what the admin trigger uses — so a
   * fresh deployment has an insights page today rather than after the next
   * 1st-of-month. Re-running refines the row in place; the scheduled run
   * finalises a month after it closes. Stock metrics describe now; flow
   * metrics are scoped to the month.
   */
  async runSnapshot(monthOf?: Date) {
    const month = monthStartUtc(monthOf ?? new Date());
    const monthEnd = nextMonthUtc(month);
    const computedAt = new Date();

    const regions = await this.prisma.region.findMany({ select: { id: true } });
    let written = 0;

    for (const region of regions) {
      const rows = await this.prisma.property.findMany({
        where: { regionId: region.id, status: { in: [...PUBLIC_STATUSES] }, deletedAt: null },
        select: { kind: true, areaM2: true, priceBaseGbp: true, listPriceGbp: true },
      });
      const sale = rows.filter((r) => r.kind === 'resale');
      const rent = rows.filter((r) => r.kind === 'rental');
      const salePrices = cleanSorted(sale.map(publicPriceGbp));
      const rentPrices = cleanSorted(rent.map(publicPriceGbp));
      const salePerM2 = perM2Values(sale);

      const [newListings, drops, views] = await Promise.all([
        this.prisma.property.count({
          where: {
            regionId: region.id,
            deletedAt: null,
            createdAt: { gte: month, lt: monthEnd },
          },
        }),
        this.prisma.propertyPriceChange.findMany({
          where: {
            createdAt: { gte: month, lt: monthEnd },
            changePct: { lt: 0 },
            property: { regionId: region.id },
          },
          select: { changePct: true },
        }),
        this.prisma.propertyViewEvent.count({
          where: {
            createdAt: { gte: month, lt: monthEnd },
            property: { regionId: region.id },
          },
        }),
      ]);

      const dropPcts = cleanSorted(drops.map((d) => Math.abs(Number(d.changePct))));
      const medianDrop = median(dropPcts);

      await this.prisma.marketSnapshot.upsert({
        where: { regionId_month: { regionId: region.id, month } },
        update: {
          saleCount: sale.length,
          rentCount: rent.length,
          saleMedianGbp: salePrices.length ? Math.round(median(salePrices) as number) : null,
          rentMedianGbp: rentPrices.length ? Math.round(median(rentPrices) as number) : null,
          salePerM2Gbp: salePerM2.length ? Math.round(median(salePerM2) as number) : null,
          newListings,
          priceDrops: drops.length,
          medianDropPct: medianDrop === null ? null : new Prisma.Decimal(medianDrop.toFixed(2)),
          views,
          computedAt,
        },
        create: {
          regionId: region.id,
          month,
          saleCount: sale.length,
          rentCount: rent.length,
          saleMedianGbp: salePrices.length ? Math.round(median(salePrices) as number) : null,
          rentMedianGbp: rentPrices.length ? Math.round(median(rentPrices) as number) : null,
          salePerM2Gbp: salePerM2.length ? Math.round(median(salePerM2) as number) : null,
          newListings,
          priceDrops: drops.length,
          medianDropPct: medianDrop === null ? null : new Prisma.Decimal(medianDrop.toFixed(2)),
          views,
          computedAt,
        },
      });
      written++;
    }

    return { month: month.toISOString().slice(0, 7), regions: written };
  }

  /** Everything the insights page shows for one region, oldest month first. */
  async regionSeries(slug: string) {
    const region = await this.prisma.region.findUnique({
      where: { slug },
      select: { id: true, slug: true, nameI18n: true },
    });
    if (!region) throw new NotFoundException('Region not found');

    const snapshots = await this.prisma.marketSnapshot.findMany({
      where: { regionId: region.id },
      orderBy: { month: 'desc' },
      take: SERIES_MONTHS,
    });

    return {
      region: { slug: region.slug, nameI18n: region.nameI18n },
      months: snapshots
        .reverse()
        .map((s) => ({
          month: s.month.toISOString().slice(0, 7),
          saleCount: s.saleCount,
          rentCount: s.rentCount,
          saleMedianGbp: s.saleMedianGbp,
          rentMedianGbp: s.rentMedianGbp,
          salePerM2Gbp: s.salePerM2Gbp,
          newListings: s.newListings,
          priceDrops: s.priceDrops,
          medianDropPct: s.medianDropPct === null ? null : Number(s.medianDropPct),
          views: s.views,
          computedAt: s.computedAt,
        })),
    };
  }

  // ── valuation v1 ─────────────────────────────────────────────────

  /**
   * "What might mine be worth?" answered from comparables: live listings of
   * the same kind in the same region (bedrooms within ±1 when given), priced
   * per m². The estimate is the median £/m² × the area; the band is the
   * 25th–75th percentile of the same, so it widens exactly when the
   * comparables disagree.
   *
   * v1 by design: no hedonic model, no weighting, no extrapolation beyond the
   * band the comparables themselves span — and a refusal below
   * MIN_COMPARABLES, because an "estimate" built on three listings is a guess
   * wearing a number. The response never carries listing ids: comparables are
   * an aggregate, not a route to somebody's home (§13.4).
   */
  async valuation(params: { kind: string; region: string; areaM2: number; bedrooms?: number }) {
    if (!['resale', 'rental'].includes(params.kind)) {
      throw new BadRequestException('kind must be resale or rental');
    }
    if (!Number.isFinite(params.areaM2) || params.areaM2 < 10 || params.areaM2 > 5000) {
      throw new BadRequestException('areaM2 must be between 10 and 5000');
    }
    if (params.bedrooms !== undefined && (!Number.isInteger(params.bedrooms) || params.bedrooms < 0 || params.bedrooms > 20)) {
      throw new BadRequestException('bedrooms must be a whole number');
    }
    const region = await this.prisma.region.findUnique({
      where: { slug: params.region },
      select: { id: true, slug: true, nameI18n: true },
    });
    if (!region) throw new NotFoundException('Region not found');

    const rows = await this.prisma.property.findMany({
      where: {
        regionId: region.id,
        status: { in: [...PUBLIC_STATUSES] },
        deletedAt: null,
        kind: params.kind as never,
        areaM2: { gt: 0 },
        ...(params.bedrooms !== undefined
          ? { bedrooms: { gte: params.bedrooms - 1, lte: params.bedrooms + 1 } }
          : {}),
      },
      select: { areaM2: true, priceBaseGbp: true, listPriceGbp: true },
    });

    const perM2 = perM2Values(rows);
    if (perM2.length < MIN_COMPARABLES) {
      return {
        available: false as const,
        comparableCount: perM2.length,
        minComparables: MIN_COMPARABLES,
        region: region.slug,
      };
    }

    const mid = median(perM2) as number;
    const p25 = percentile(perM2, 0.25) as number;
    const p75 = percentile(perM2, 0.75) as number;

    return {
      available: true as const,
      comparableCount: perM2.length,
      region: region.slug,
      kind: params.kind,
      areaM2: params.areaM2,
      perM2MedianGbp: Math.round(mid),
      estimateGbp: Math.round(mid * params.areaM2),
      lowGbp: Math.round(p25 * params.areaM2),
      highGbp: Math.round(p75 * params.areaM2),
    };
  }
}
