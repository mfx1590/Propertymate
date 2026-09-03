import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanSorted, median, perM2Values, publicPriceGbp } from '../../common/market-stats';

/** Statuses a member of the public can see (matches PropertiesService.getPublic). */
const PUBLIC_STATUSES = ['live'] as const;

/**
 * Region landing-page data (Plan §6.1 "region landing pages", §1 SEO).
 *
 * The stats here are the local knowledge a foreign buyer arrives without.
 * Someone googling "property for sale in Kyrenia" from London has no idea what
 * a normal price is, and — more to the point for the TRNC — no idea that the
 * deed type on a listing is the single most consequential thing about it. So
 * the deed breakdown is first-class rather than a filter tucked away in search.
 */
@Injectable()
export class RegionsService {
  constructor(private readonly prisma: PrismaService) {}

  listTopLevel() {
    return this.prisma.region.findMany({
      where: { parentId: null },
      select: { id: true, slug: true, nameI18n: true, lat: true, lng: true },
      orderBy: { slug: 'asc' },
    });
  }

  async detail(slug: string) {
    const region = await this.prisma.region.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        nameI18n: true,
        lat: true,
        lng: true,
        parent: { select: { slug: true, nameI18n: true } },
        children: {
          select: { slug: true, nameI18n: true },
          orderBy: { slug: 'asc' },
        },
      },
    });
    if (!region) throw new NotFoundException('Region not found');

    // A parent region's page should count its districts too — someone landing
    // on "Kyrenia" means the area, not the administrative centre alone.
    const regionIds = [region.id, ...(await this.childIds(region.id))];

    const listings = await this.prisma.property.findMany({
      where: {
        regionId: { in: regionIds },
        status: { in: [...PUBLIC_STATUSES] },
        deletedAt: null,
      },
      select: {
        kind: true,
        deedType: true,
        bedrooms: true,
        areaM2: true,
        priceBaseGbp: true,
        listPriceGbp: true,
      },
    });

    return { ...region, stats: this.summarise(listings) };
  }

  private async childIds(parentId: string): Promise<string[]> {
    const kids = await this.prisma.region.findMany({
      where: { parentId },
      select: { id: true },
    });
    return kids.map((k) => k.id);
  }

  private summarise(
    rows: {
      kind: string;
      deedType: string;
      bedrooms: number | null;
      areaM2: number | null;
      priceBaseGbp: unknown;
      listPriceGbp: unknown;
    }[],
  ) {
    const sale = rows.filter((r) => r.kind === 'resale');
    const rent = rows.filter((r) => r.kind === 'rental');

    const deedTypes: Record<string, number> = {};
    for (const r of rows) deedTypes[r.deedType] = (deedTypes[r.deedType] ?? 0) + 1;

    return {
      total: rows.length,
      forSale: sale.length,
      forRent: rent.length,
      // Sale and rent prices are different quantities entirely; averaging them
      // together would produce a number that describes nothing.
      sale: this.priceBand(sale),
      rent: this.priceBand(rent),
      deedTypes,
    };
  }

  // The §13.5 price rule and the median arithmetic live in common/market-stats
  // now, shared with the insights module (step 25) — a second copy of "which
  // price is public" would eventually drift and leak an agent's margin.
  private priceBand(rows: { areaM2: number | null; priceBaseGbp: unknown; listPriceGbp: unknown }[]) {
    const valid = cleanSorted(rows.map(publicPriceGbp));
    if (valid.length === 0) {
      return { count: 0, medianGbp: null, minGbp: null, maxGbp: null, medianPerM2: null };
    }
    const perM2 = perM2Values(rows);
    return {
      count: valid.length,
      medianGbp: Math.round(median(valid) as number),
      minGbp: valid[0],
      maxGbp: valid[valid.length - 1],
      medianPerM2: perM2.length ? Math.round(median(perM2) as number) : null,
    };
  }
}
