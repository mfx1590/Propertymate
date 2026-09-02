import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { MIN_LISTING_PHOTOS, VERIFICATION_SLA_HOURS } from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaService } from '../media/media.service';
import { SubscriptionsService } from '../marketplace/subscriptions.service';
import { UpdatePropertyDto } from './dto/properties.dto';

/** Statuses in which the lister may still edit core fields. */
const EDITABLE_STATUSES = ['draft', 'pending_verification'] as const;

/** One visit = one view within this window, per viewer per listing. */
const VIEW_DEDUPE_MINUTES = 30;
/** phash Hamming distance at or below which we warn about a duplicate photo. */
const DUPLICATE_PHASH_DISTANCE = 6;

@Injectable()
export class PropertiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly events: EventEmitter2,
  ) {}

  // ── drafts & editing ─────────────────────────────────────────────

  async createDraft(userId: string, kind: 'resale' | 'rental', ip?: string) {
    // §13.3: listing uploads require an active subscription (admin-granted until Phase 3)
    if (!(await this.subscriptions.hasActive(userId))) {
      throw new ForbiddenException('SUBSCRIPTION_REQUIRED: an active subscription is needed to create listings');
    }
    const region = await this.prisma.region.findFirstOrThrow(); // placeholder until step 2 of wizard
    const property = await this.prisma.property.create({
      data: {
        kind,
        createdByUserId: userId,
        titleI18n: { en: '' },
        descriptionI18n: { en: '' },
        regionId: region.id,
        priceAmount: 0,
        priceCurrency: 'GBP',
        priceBaseGbp: 0,
        status: 'draft',
      },
    });
    await this.audit.log({
      actorId: userId,
      action: 'listing.create_draft',
      entityType: 'property',
      entityId: property.id,
      ip,
    });
    return property;
  }

  async updateDraft(userId: string, propertyId: string, dto: UpdatePropertyDto, ip?: string) {
    const property = await this.getOwnedEditable(userId, propertyId);

    const data: Prisma.PropertyUpdateInput = {};
    if (dto.title !== undefined) data.titleI18n = { en: dto.title };
    if (dto.description !== undefined) data.descriptionI18n = { en: dto.description };
    if (dto.district !== undefined) data.district = dto.district;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.bedrooms !== undefined) data.bedrooms = dto.bedrooms;
    if (dto.bathrooms !== undefined) data.bathrooms = dto.bathrooms;
    if (dto.areaM2 !== undefined) data.areaM2 = dto.areaM2;
    if (dto.plotM2 !== undefined) data.plotM2 = dto.plotM2;
    if (dto.deedType !== undefined) data.deedType = dto.deedType as never;
    if (dto.furnished !== undefined) data.furnished = dto.furnished;
    if (dto.features !== undefined) data.features = dto.features;

    if (dto.regionSlug !== undefined) {
      const region = await this.prisma.region.findUnique({ where: { slug: dto.regionSlug } });
      if (!region) throw new BadRequestException('Unknown region');
      data.region = { connect: { id: region.id } };
    }

    // Captured before the update so the history row can record both sides.
    let priceChange: {
      oldAmount: number;
      newAmount: number;
      currency: string;
      oldBaseGbp: number;
      newBaseGbp: number;
    } | null = null;

    if (dto.priceAmount !== undefined || dto.priceCurrency !== undefined) {
      const amount = dto.priceAmount ?? Number(property.priceAmount);
      const currency = dto.priceCurrency ?? property.priceCurrency;
      const baseGbp = await this.toBaseGbp(amount, currency);
      data.priceAmount = amount;
      data.priceCurrency = currency;
      data.priceBaseGbp = baseGbp;

      const oldBaseGbp = Number(property.priceBaseGbp);
      // Only a real movement on an already-priced listing counts. A draft
      // being filled in for the first time (0 → 200000) is not a price change,
      // and re-saving the form unchanged must not manufacture history.
      if (oldBaseGbp > 0 && baseGbp > 0 && baseGbp !== oldBaseGbp) {
        priceChange = {
          oldAmount: Number(property.priceAmount),
          newAmount: amount,
          currency,
          oldBaseGbp,
          newBaseGbp: baseGbp,
        };
      }
    }

    const updated = await this.prisma.property.update({ where: { id: propertyId }, data });

    if (priceChange) {
      await this.prisma.propertyPriceChange.create({
        data: {
          propertyId,
          oldAmount: priceChange.oldAmount,
          newAmount: priceChange.newAmount,
          currency: priceChange.currency,
          oldBaseGbp: priceChange.oldBaseGbp,
          newBaseGbp: priceChange.newBaseGbp,
          changePct:
            Math.round(
              ((priceChange.newBaseGbp - priceChange.oldBaseGbp) / priceChange.oldBaseGbp) * 10000,
            ) / 100,
          changedByUserId: userId,
        },
      });
    }
    await this.audit.log({
      actorId: userId,
      action: 'listing.update',
      entityType: 'property',
      entityId: propertyId,
      after: dto as object,
      ip,
    });
    if (updated.status === 'live') this.events.emit('listing.updated', { propertyId });
    return updated;
  }

  // ── photos ───────────────────────────────────────────────────────

  async addPhoto(
    userId: string,
    propertyId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    await this.getOwnedEditable(userId, propertyId);
    const processed = await this.media.processListingPhoto(file);

    // duplicate detection across ALL listings (Plan §2.4)
    const candidates = await this.prisma.propertyMedia.findMany({
      where: { phash: { not: null } },
      select: { propertyId: true, phash: true },
      take: 5000,
    });
    const duplicateOfOtherListing = candidates.some(
      (c) =>
        c.propertyId !== propertyId &&
        c.phash &&
        MediaService.hammingDistance(c.phash, processed.phash) <= DUPLICATE_PHASH_DISTANCE,
    );

    const count = await this.prisma.propertyMedia.count({ where: { propertyId } });
    const media = await this.prisma.propertyMedia.create({
      data: {
        propertyId,
        type: 'photo',
        url: processed.url,
        phash: processed.phash,
        sortOrder: count,
      },
    });

    return { ...media, thumbUrl: processed.thumbUrl, duplicateWarning: duplicateOfOtherListing };
  }

  async reorderPhotos(userId: string, propertyId: string, mediaIds: string[]) {
    await this.getOwnedEditable(userId, propertyId);
    await this.prisma.$transaction(
      mediaIds.map((id, index) =>
        this.prisma.propertyMedia.updateMany({
          where: { id, propertyId },
          data: { sortOrder: index },
        }),
      ),
    );
    return this.prisma.propertyMedia.findMany({
      where: { propertyId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async deletePhoto(userId: string, propertyId: string, mediaId: string) {
    await this.getOwnedEditable(userId, propertyId);
    await this.prisma.propertyMedia.deleteMany({ where: { id: mediaId, propertyId } });
    return { ok: true };
  }

  // ── documents (private bucket, Plan §2.4) ────────────────────────

  async addDocument(
    userId: string,
    propertyId: string,
    documentType: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname: string },
    ip?: string,
  ) {
    await this.getOwnedEditable(userId, propertyId);
    if (file.size > 20 * 1024 * 1024) throw new BadRequestException('Document exceeds 20MB limit');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = `listings/${propertyId}/${documentType}-${Date.now()}`;
    await this.storage.putPrivateDocument(key, file.buffer, file.mimetype);

    const doc = await this.prisma.document.create({
      data: {
        ownerUserId: userId,
        entityType: 'listing',
        entityId: propertyId,
        documentType,
        storageKey: key,
        mime: file.mimetype,
        size: file.size,
        sha256,
        status: 'pending',
      },
    });
    // re-upload of a rejected doc requeues the listing for review (Plan §4 step 6/7)
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { status: true },
    });
    if (property?.status === 'pending_verification' || property?.status === 'live') {
      const open = await this.prisma.verificationItem.count({
        where: { entityType: 'listing', entityId: propertyId, status: { in: ['queued', 'claimed'] } },
      });
      if (open === 0) {
        await this.prisma.verificationItem.create({
          data: {
            entityType: 'listing',
            entityId: propertyId,
            status: 'queued',
            slaDueAt: new Date(Date.now() + 24 * 3_600_000),
          },
        });
      }
    }

    await this.audit.log({
      actorId: userId,
      action: 'document.upload',
      entityType: 'document',
      entityId: doc.id,
      after: { propertyId, documentType, sha256 },
      ip,
    });
    return { id: doc.id, documentType: doc.documentType, status: doc.status, uploadedAt: doc.uploadedAt };
  }

  async listDocuments(userId: string, propertyId: string) {
    await this.assertOwned(userId, propertyId);
    return this.prisma.document.findMany({
      where: { entityType: 'listing', entityId: propertyId, deletedAt: null },
      select: {
        id: true,
        documentType: true,
        status: true,
        rejectReasonCode: true,
        rejectNote: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  /** Requirements config for this lister on this kind — drives the upload boxes (Plan §2.2). */
  async getListingRequirements(userId: string, kind: 'resale' | 'rental') {
    const roleKeys = (
      await this.prisma.userRole.findMany({
        where: { userId },
        select: { role: { select: { key: true } } },
      })
    ).map((ur) => ur.role.key);

    // owners upload owner docs; agents/agencies upload the mandate set
    const relevant: string[] = [];
    if (roleKeys.includes('owner')) relevant.push('owner');
    if (roleKeys.includes('solo_agent') || roleKeys.includes('agency')) relevant.push('solo_agent');
    if (relevant.length === 0) return [];

    return this.prisma.verificationRequirement.findMany({
      where: {
        context: kind === 'resale' ? 'listing_resale' : 'listing_rental',
        role: { key: { in: relevant } },
      },
      select: { documentType: true, isRequired: true, titleI18n: true, helpI18n: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ── submission ───────────────────────────────────────────────────

  async submit(userId: string, propertyId: string, ip?: string) {
    const property = await this.getOwnedEditable(userId, propertyId);
    if (property.status !== 'draft') {
      throw new BadRequestException('Only drafts can be submitted');
    }

    const problems: string[] = [];
    const title = (property.titleI18n as { en?: string })?.en;
    if (!title) problems.push('Title is required');
    if (!(property.descriptionI18n as { en?: string })?.en) problems.push('Description is required');
    if (!property.lat || !property.lng) problems.push('Map location is required');
    if (Number(property.priceAmount) <= 0) problems.push('Price is required');
    if (property.kind === 'resale' && property.deedType === 'na') {
      problems.push('Deed type is required for resale listings');
    }

    const photoCount = await this.prisma.propertyMedia.count({ where: { propertyId } });
    if (photoCount < MIN_LISTING_PHOTOS) {
      problems.push(`At least ${MIN_LISTING_PHOTOS} photos are required (you have ${photoCount})`);
    }

    const requirements = await this.getListingRequirements(userId, property.kind);
    const docs = await this.prisma.document.findMany({
      where: { entityType: 'listing', entityId: propertyId, deletedAt: null },
      select: { documentType: true },
    });
    const uploadedTypes = new Set(docs.map((d) => d.documentType));
    for (const req of requirements) {
      if (req.isRequired && !uploadedTypes.has(req.documentType)) {
        problems.push(`Missing document: ${(req.titleI18n as { en?: string })?.en ?? req.documentType}`);
      }
    }

    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }

    const updated = await this.prisma.property.update({
      where: { id: propertyId },
      data: { status: 'pending_verification' },
    });
    await this.prisma.verificationItem.create({
      data: {
        entityType: 'listing',
        entityId: propertyId,
        status: 'queued',
        slaDueAt: new Date(Date.now() + VERIFICATION_SLA_HOURS * 3_600_000),
      },
    });
    await this.audit.log({
      actorId: userId,
      action: 'listing.submit',
      entityType: 'property',
      entityId: propertyId,
      ip,
    });
    return updated;
  }

  /** One-tap 90-day availability confirmation (Plan §4 freshness rule). */
  async confirmAvailability(userId: string, propertyId: string, ip?: string) {
    await this.assertOwned(userId, propertyId);
    const updated = await this.prisma.property.update({
      where: { id: propertyId },
      data: {
        availabilityConfirmedAt: new Date(),
        // a paused-for-staleness listing comes back on confirmation
        ...((await this.prisma.property.findUnique({ where: { id: propertyId } }))?.status === 'paused'
          ? { status: 'live' as const }
          : {}),
      },
    });
    await this.audit.log({
      actorId: userId,
      action: 'listing.confirm_availability',
      entityType: 'property',
      entityId: propertyId,
      ip,
    });
    if (updated.status === 'live') this.events.emit('listing.updated', { propertyId });
    return updated;
  }

  // ── reads ────────────────────────────────────────────────────────

  async listMine(userId: string) {
    return this.prisma.property.findMany({
      where: { createdByUserId: userId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        region: { select: { slug: true, nameI18n: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Public detail: live/under_offer/sold/rented are viewable; drafts only by their owner. */
  /**
   * A view is recorded at most once per viewer per listing per
   * VIEW_DEDUPE_MINUTES. Without this the SSR page counts two views for one
   * visit (Next calls the fetch once for `generateMetadata` and once for the
   * page), and a refresh or a back-button would inflate demand further.
   */
  private async recordView(propertyId: string, viewerUserId?: string, sessionKey?: string) {
    try {
      // Deduped by a unique key rather than a read-then-write: this runs
      // fire-and-forget so it never adds latency to a public page, which means
      // two near-simultaneous requests would both pass a "seen recently?" check.
      // Postgres rejecting the second insert is what actually makes it one view.
      const identity = viewerUserId ?? sessionKey;
      const bucket = Math.floor(Date.now() / (VIEW_DEDUPE_MINUTES * 60_000));
      const dedupeKey = identity ? `${propertyId}:${identity}:${bucket}` : null;

      const { count } = await this.prisma.propertyViewEvent.createMany({
        data: [
          {
            propertyId,
            viewerId: viewerUserId ?? null,
            sessionKey: sessionKey ?? null,
            dedupeKey,
          },
        ],
        skipDuplicates: true,
      });
      if (count === 0) return; // same visit, already counted

      await this.prisma.property.update({
        where: { id: propertyId },
        data: { viewCount: { increment: 1 } },
      });
    } catch {
      // view counting must never break the page it is counting
    }
  }

  async getPublic(propertyId: string, viewerUserId?: string, sessionKey?: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        region: { select: { slug: true, nameI18n: true, lat: true, lng: true } },
        createdBy: { select: { id: true } },
        // §6.1: the price trajectory is public. A listing that has come down
        // is the single most useful signal a buyer can have, and hiding it
        // would only benefit the seller.
        priceChanges: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            oldBaseGbp: true,
            newBaseGbp: true,
            changePct: true,
            createdAt: true,
          },
        },
      },
    });
    if (!property) throw new NotFoundException('Listing not found');

    const publicStatuses = ['live', 'under_offer', 'sold', 'rented'];
    const isOwner = viewerUserId && property.createdBy.id === viewerUserId;
    if (!publicStatuses.includes(property.status) && !isOwner) {
      throw new NotFoundException('Listing not found');
    }

    if (publicStatuses.includes(property.status) && !isOwner) {
      // Fire-and-forget: lifetime counter plus one event row, which is what
      // gives the analytics funnel a time series (§6.7) and feeds the §8
      // co-visitation recommender. The lister's own visits are not demand.
      void this.recordView(propertyId, viewerUserId, sessionKey);
    }

    const { createdBy, ...rest } = property;

    // A single "reduced by N%" figure for the card badge, measured from the
    // highest price the listing has held to what it asks now — so a seller
    // cannot hide a reduction by nudging the price up and back down.
    const priceReducedPct = (() => {
      const changes = property.priceChanges;
      if (changes.length === 0) return null;
      const peak = Math.max(...changes.map((c) => Number(c.oldBaseGbp)), Number(rest.priceBaseGbp));
      const now = Number(rest.priceBaseGbp);
      if (!(peak > 0) || now >= peak) return null;
      return Math.round(((peak - now) / peak) * 1000) / 10;
    })();
    if (!isOwner) {
      // §13.5: public sees ONLY the final buyer price — never the profit/commission breakdown.
      // §13.4: strip internal identity fields so owner/agent anonymity holds.
      const {
        platformProfitGbp,
        agentCommissionGbp,
        priceBaseGbp,
        priceAmount,
        priceCurrency,
        createdByUserId,
        onBehalfOfOwnerId,
        publishedByAgentId,
        mandateDocumentId,
        priceChanges,
        ...pub
      } = rest;
      const finalGbp = rest.listPriceGbp ?? priceBaseGbp;
      return {
        ...pub,
        priceAmount: finalGbp,
        priceCurrency: 'GBP',
        priceBaseGbp: finalGbp,
        listPriceGbp: rest.listPriceGbp,
        // Percentages only. The absolute amounts on a price-change row are the
        // *owner's* ask, and on a mediated resale (§13.4) that is not the price
        // the public is shown — publishing it would expose the agent's margin,
        // which §13.5 forbids. A percentage move is the same either way.
        priceChanges: priceChanges.map((c) => ({
          changePct: Number(c.changePct),
          createdAt: c.createdAt,
        })),
        priceReducedPct,
        isOwner: false,
      };
    }
    return { ...rest, isOwner: true };
  }

  // ── favorites ────────────────────────────────────────────────────

  async setFavorite(userId: string, propertyId: string, favored: boolean) {
    if (favored) {
      await this.prisma.favorite.upsert({
        where: { userId_propertyId: { userId, propertyId } },
        update: {},
        create: { userId, propertyId },
      });
      await this.prisma.property.update({
        where: { id: propertyId },
        data: { saveCount: { increment: 1 } },
      });
    } else {
      const deleted = await this.prisma.favorite.deleteMany({ where: { userId, propertyId } });
      if (deleted.count > 0) {
        await this.prisma.property.update({
          where: { id: propertyId },
          data: { saveCount: { decrement: 1 } },
        });
      }
    }
    return { favored };
  }

  async listFavorites(userId: string) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      include: {
        property: {
          include: {
            media: { orderBy: { sortOrder: 'asc' }, take: 1 },
            region: { select: { slug: true, nameI18n: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return favorites.map((f) => f.property);
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async toBaseGbp(amount: number, currency: string): Promise<number> {
    if (currency === 'GBP') return amount;
    const rate = await this.prisma.fxRate.findUnique({
      where: { base_quote: { base: 'GBP', quote: currency } },
    });
    if (!rate) throw new BadRequestException(`No FX rate for ${currency}`);
    return Math.round((amount / Number(rate.rate)) * 100) / 100;
  }

  private async assertOwned(userId: string, propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId, deletedAt: null },
    });
    if (!property) throw new NotFoundException('Listing not found');
    if (property.createdByUserId !== userId) {
      throw new ForbiddenException('You do not manage this listing');
    }
    return property;
  }

  private async getOwnedEditable(userId: string, propertyId: string) {
    const property = await this.assertOwned(userId, propertyId);
    if (!EDITABLE_STATUSES.includes(property.status as (typeof EDITABLE_STATUSES)[number]) && property.status !== 'live') {
      throw new BadRequestException(`Listing is not editable in status ${property.status}`);
    }
    return property;
  }
}
