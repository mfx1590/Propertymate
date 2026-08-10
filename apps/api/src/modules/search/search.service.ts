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
  /** §8 ranking inputs — see RANKING_RULES. */
  featured: number;
  freshnessTier: number;
  completenessScore: number;
  listerScore: number;
  _geo?: { lat: number; lng: number };
}

const INDEX_NAME = 'listings';

/**
 * Plan §8 ranking: verified > freshness > completeness > lister reputation.
 * "Verified" needs no rule — only verified listings are ever indexed.
 *
 * Meilisearch applies these lexicographically, so freshness is bucketed into
 * tiers rather than left as a timestamp: a raw timestamp is unique per listing
 * and would decide every comparison, leaving the two rules below it dead.
 */
const RANKING_RULES = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'sort',
  'exactness',
  // A paid/earned boost reorders VERIFIED supply only — every document in this
  // index is already a live, verified listing, so featuring can never put an
  // unverified one in front of a buyer (§8).
  'featured:desc',
  'freshnessTier:desc',
  'completenessScore:desc',
  'listerScore:desc',
];

const FRESH_DAYS = 30;
const AGING_DAYS = 90;

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
          'priceBaseGbp', 'areaM2', 'features', '_geo', 'featured',
        ],
        sortableAttributes: ['priceBaseGbp', 'createdAtTs', 'pricePerM2'],
        searchableAttributes: ['title', 'description', 'regionName', 'district'],
        rankingRules: RANKING_RULES,
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

  /**
   * A lister's ranking score changed (nightly sweep or a rating reveal), so the
   * `listerScore` baked into their live listings is stale. Search owns the
   * index; the deals module just announces the new score (§2.3 event bus).
   */
  @OnEvent('reputation.updated')
  async syncListerListings({ userId }: { userId: string }) {
    try {
      const listings = await this.prisma.property.findMany({
        where: {
          status: 'live',
          deletedAt: null,
          OR: [{ publishedByAgentId: userId }, { createdByUserId: userId }],
        },
        select: { id: true },
      });
      for (const { id } of listings) await this.syncListing({ propertyId: id });
    } catch (err) {
      this.logger.error(`Failed to re-sync listings for lister ${userId}: ${err}`);
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

  /**
   * Freshness bucket from the 90-day availability confirmation (§4): a listing
   * confirmed (or created) recently outranks one drifting toward its sweep.
   */
  private freshnessTier(confirmedAt: Date | null, createdAt: Date): number {
    const ageDays = (Date.now() - (confirmedAt ?? createdAt).getTime()) / 86_400_000;
    if (ageDays <= FRESH_DAYS) return 2;
    if (ageDays <= AGING_DAYS) return 1;
    return 0;
  }

  /** 0–100 listing completeness (§8): photos, description, and hard facts. */
  private completeness(p: {
    media: unknown[];
    descriptionI18n: unknown;
    areaM2: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    lat: number | null;
    features: unknown;
  }): number {
    const description = ((p.descriptionI18n as { en?: string })?.en ?? '').length;
    const featureCount = Array.isArray(p.features) ? p.features.length : 0;
    const parts = [
      Math.min(1, p.media.length / 8) * 30, // 5 is the floor to publish; 8 is a full set
      Math.min(1, description / 600) * 25,
      p.areaM2 ? 15 : 0,
      p.bedrooms !== null && p.bathrooms !== null ? 10 : 0,
      p.lat ? 10 : 0,
      Math.min(1, featureCount / 5) * 10,
    ];
    return Math.round(parts.reduce((a, b) => a + b, 0));
  }

  private async buildDocument(propertyId: string): Promise<ListingDocument | null> {
    const p = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        region: { select: { slug: true, nameI18n: true } },
      },
    });
    if (!p || p.status !== 'live') return null;

    // The publishing agent is the lister on a mediated resale (§13.4); on a
    // direct listing it is whoever created it.
    const listerId = p.publishedByAgentId ?? p.createdByUserId;
    const lister = await this.prisma.agentProfile.findUnique({
      where: { userId: listerId },
      select: { rankingScore: true },
    });

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
      featured: p.featuredUntil && p.featuredUntil > new Date() ? 1 : 0,
      freshnessTier: this.freshnessTier(p.availabilityConfirmedAt, p.createdAt),
      completenessScore: this.completeness(p),
      // Owner-direct listings have no agent profile — a neutral 50 keeps them
      // from being buried by an absent score rather than a bad one.
      listerScore: lister?.rankingScore ?? 50,
      ...(p.lat && p.lng ? { _geo: { lat: p.lat, lng: p.lng } } : {}),
    };
  }
}
