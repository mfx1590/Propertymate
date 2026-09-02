import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
    // §13.5: a mediated resale's public price is the list price, not the
    // owner's ask. Stats must describe what a buyer would actually pay.
    const priceOf = (r: { priceBaseGbp: unknown; listPriceGbp: unknown }) =>
      Number(r.listPriceGbp ?? r.priceBaseGbp);

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
      sale: this.priceBand(sale.map(priceOf), sale),
      rent: this.priceBand(rent.map(priceOf), rent),
      deedTypes,
    };
  }

  private priceBand(
    prices: number[],
    rows: { areaM2: number | null; priceBaseGbp: unknown; listPriceGbp: unknown }[],
  ) {
    const valid = prices.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (valid.length === 0) {
      return { count: 0, medianGbp: null, minGbp: null, maxGbp: null, medianPerM2: null };
    }

    // Median, not mean: one £3m villa in a region of £150k flats would drag an
    // average somewhere no actual listing sits.
    const median = (xs: number[]) => {
      const mid = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
    };

    const perM2 = rows
      .filter((r) => r.areaM2 && r.areaM2 > 0)
      .map((r) => Number(r.listPriceGbp ?? r.priceBaseGbp) / (r.areaM2 as number))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);

    return {
      count: valid.length,
      medianGbp: median(valid),
      minGbp: valid[0],
      maxGbp: valid[valid.length - 1],
      medianPerM2: perM2.length ? Math.round(median(perM2)) : null,
    };
  }
}
