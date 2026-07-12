import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { MeiliSearch, Index } from 'meilisearch';
import { PrismaService } from '../../prisma/prisma.service';

export interface ListingDocument {
  id: string;
  kind: string;
  title: string;
  description: string;
  regionSlug: string;
  regionName: string;
  district: string | null;
  priceBaseGbp: number;
  priceAmount: number;
  priceCurrency: string;
  pricePerM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  deedType: string;
  furnished: boolean;
  features: string[];
  coverUrl: string | null;
  createdAtTs: number;
  _geo?: { lat: number; lng: number };
}

const INDEX_NAME = 'listings';

/**
 * Only `live` listings exist in the index (Plan §4 step 6). Sync is
 * event-driven off the local bus; a BullMQ-backed outbox replaces this
 * in the hardening pass for at-least-once delivery.
 */
@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger(SearchService.name);
  private index: Index<Record<string, unknown>>;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const client = new MeiliSearch({
      host: config.get<string>('MEILI_HOST') ?? 'http://localhost:7700',
      apiKey: config.get<string>('MEILI_MASTER_KEY'),
    });
    this.index = client.index(INDEX_NAME);
  }

  async onModuleInit() {
    try {
      await this.index.updateSettings({
        filterableAttributes: [
          'kind', 'regionSlug', 'bedrooms', 'bathrooms', 'deedType', 'furnished',
          'priceBaseGbp', 'areaM2', 'features', '_geo',
        ],
        sortableAttributes: ['priceBaseGbp', 'createdAtTs', 'pricePerM2'],
        searchableAttributes: ['title', 'description', 'regionName', 'district'],
      });
    } catch (err) {
      this.logger.warn(`Meilisearch not reachable at startup — search disabled until it is: ${err}`);
    }
  }

  @OnEvent('listing.live')
  @OnEvent('listing.updated')
  async syncListing({ propertyId }: { propertyId: string }) {
    try {
      const doc = await this.buildDocument(propertyId);
      if (doc) {
        await this.index.addDocuments([doc as unknown as Record<string, unknown>]);
      } else {
        await this.index.deleteDocument(propertyId);
      }
    } catch (err) {
      this.logger.error(`Failed to sync listing ${propertyId}: ${err}`);
    }
  }

  @OnEvent('listing.unlisted')
  async removeListing({ propertyId }: { propertyId: string }) {
    try {
      await this.index.deleteDocument(propertyId);
    } catch (err) {
      this.logger.error(`Failed to remove listing ${propertyId}: ${err}`);
    }
  }

  async search(params: {
    q?: string;
    kind?: string;
    region?: string;
    minPrice?: number;
    maxPrice?: number;
    minBeds?: number;
    deedType?: string;
    furnished?: boolean;
    sort?: 'newest' | 'price_asc' | 'price_desc';
    page?: number;
  }) {
    const filters: string[] = [];
    if (params.kind) filters.push(`kind = ${params.kind}`);
    if (params.region) filters.push(`regionSlug = ${params.region}`);
    if (params.minPrice !== undefined) filters.push(`priceBaseGbp >= ${params.minPrice}`);
    if (params.maxPrice !== undefined) filters.push(`priceBaseGbp <= ${params.maxPrice}`);
    if (params.minBeds !== undefined) filters.push(`bedrooms >= ${params.minBeds}`);
    if (params.deedType) filters.push(`deedType = ${params.deedType}`);
    if (params.furnished !== undefined) filters.push(`furnished = ${params.furnished}`);

    const sortMap = {
      newest: ['createdAtTs:desc'],
      price_asc: ['priceBaseGbp:asc'],
      price_desc: ['priceBaseGbp:desc'],
    } as const;

    const page = Math.max(1, params.page ?? 1);
    const result = await this.index.search(params.q ?? '', {
      filter: filters.length ? filters.join(' AND ') : undefined,
      sort: params.sort ? [...sortMap[params.sort]] : undefined,
      hitsPerPage: 24,
      page,
    });

    return {
      hits: result.hits,
      totalHits: result.totalHits,
      page: result.page,
      totalPages: result.totalPages,
    };
  }

  /** Rebuild the whole index from the database (ops/recovery tool). */
  async reindexAll(): Promise<{ indexed: number }> {
    const live = await this.prisma.property.findMany({
      where: { status: 'live', deletedAt: null },
      select: { id: true },
    });
    let indexed = 0;
    for (const { id } of live) {
      const doc = await this.buildDocument(id);
      if (doc) {
        await this.index.addDocuments([doc as unknown as Record<string, unknown>]);
        indexed++;
      }
    }
    return { indexed };
  }

  private async buildDocument(propertyId: string): Promise<ListingDocument | null> {
    const p = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        region: { select: { slug: true, nameI18n: true } },
      },
    });
    if (!p || p.status !== 'live') return null;

    // §13.5 buyer-pays: mediated resales index at the FINAL list price
    const priceBaseGbp = p.listPriceGbp ? Number(p.listPriceGbp) : Number(p.priceBaseGbp);
    return {
      id: p.id,
      kind: p.kind,
      title: (p.titleI18n as { en?: string })?.en ?? '',
      description: ((p.descriptionI18n as { en?: string })?.en ?? '').slice(0, 500),
      regionSlug: p.region.slug,
      regionName: (p.region.nameI18n as { en?: string })?.en ?? p.region.slug,
      district: p.district,
      priceBaseGbp,
      priceAmount: p.listPriceGbp ? priceBaseGbp : Number(p.priceAmount),
      priceCurrency: p.listPriceGbp ? 'GBP' : p.priceCurrency,
      pricePerM2: p.areaM2 ? Math.round(priceBaseGbp / p.areaM2) : null,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      areaM2: p.areaM2,
      deedType: p.deedType,
      furnished: p.furnished,
      features: Array.isArray(p.features) ? (p.features as string[]) : [],
      coverUrl: p.media[0]?.url ?? null,
      createdAtTs: p.createdAt.getTime(),
      ...(p.lat && p.lng ? { _geo: { lat: p.lat, lng: p.lng } } : {}),
    };
  }
}
