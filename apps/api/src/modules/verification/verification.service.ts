import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PRICE_ANOMALY_THRESHOLD } from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface DocumentDecision {
  documentId: string;
  status: 'approved' | 'rejected';
  rejectReasonCode?: 'illegible' | 'expired' | 'name_mismatch' | 'wrong_type' | 'suspected_forgery' | 'other';
  rejectNote?: string;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  // ── queue ────────────────────────────────────────────────────────

  async queue(filters: { entityType?: string; status?: string; overdueOnly?: boolean }) {
    const items = await this.prisma.verificationItem.findMany({
      where: {
        entityType: filters.entityType as never,
        status: (filters.status as never) ?? { in: ['queued', 'claimed'] },
        ...(filters.overdueOnly ? { slaDueAt: { lt: new Date() } } : {}),
      },
      orderBy: { slaDueAt: 'asc' },
      take: 100,
    });

    // enrich with a human-readable summary of the entity under review
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        summary: await this.entitySummary(item.entityType, item.entityId),
        overdue: item.slaDueAt < new Date(),
      })),
    );
  }

  async claim(adminId: string, itemId: string) {
    const item = await this.prisma.verificationItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Queue item not found');
    if (item.status !== 'queued') throw new BadRequestException(`Item is ${item.status}`);
    return this.prisma.verificationItem.update({
      where: { id: itemId },
      data: { status: 'claimed', claimedByAdminId: adminId },
    });
  }

  // ── detail (the review screen) ───────────────────────────────────

  async detail(itemId: string) {
    const item = await this.prisma.verificationItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Queue item not found');

    if (item.entityType === 'listing') {
      return { ...item, listing: await this.listingReview(item.entityId) };
    }
    if (item.entityType === 'profile') {
      return { ...item, profile: await this.profileReview(item.entityId) };
    }
    return item;
  }

  private async listingReview(propertyId: string) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        region: { select: { slug: true, nameI18n: true } },
        createdBy: { select: { id: true, phone: true, email: true } },
      },
    });
    if (!property) throw new NotFoundException('Listing not found');

    const documents = await this.documentsWithUrls('listing', propertyId);
    const requirements = await this.prisma.verificationRequirement.findMany({
      where: { context: property.kind === 'resale' ? 'listing_resale' : 'listing_rental' },
      select: { documentType: true, isRequired: true, titleI18n: true, role: { select: { key: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    return {
      property,
      documents,
      requirements,
      fraudSignals: await this.fraudSignals(propertyId, documents, property),
    };
  }

  private async profileReview(userRoleId: string) {
    const userRole = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: {
        user: { select: { id: true, phone: true, email: true, createdAt: true } },
        role: { select: { key: true, name: true } },
      },
    });
    if (!userRole) throw new NotFoundException('Role assignment not found');

    const documents = await this.documentsWithUrls('profile', userRoleId);
    const requirements = await this.prisma.verificationRequirement.findMany({
      where: { context: 'profile', roleId: userRole.roleId },
      select: { documentType: true, isRequired: true, titleI18n: true },
      orderBy: { sortOrder: 'asc' },
    });

    // same-document-hash across accounts (Plan §4 fraud tools)
    const shaHits: string[] = [];
    for (const doc of documents) {
      const reuse = await this.prisma.document.count({
        where: { sha256: doc.sha256, ownerUserId: { not: userRole.user.id }, deletedAt: null },
      });
      if (reuse > 0) shaHits.push(`${doc.documentType}: same file used by ${reuse} other account(s)`);
    }

    return { userRole, documents, requirements, fraudSignals: shaHits };
  }

  private async documentsWithUrls(entityType: string, entityId: string) {
    const docs = await this.prisma.document.findMany({
      where: { entityType, entityId, deletedAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
    return Promise.all(
      docs.map(async (d) => ({
        id: d.id,
        documentType: d.documentType,
        mime: d.mime,
        size: d.size,
        sha256: d.sha256,
        status: d.status,
        rejectReasonCode: d.rejectReasonCode,
        rejectNote: d.rejectNote,
        uploadedAt: d.uploadedAt,
        ownerUserId: d.ownerUserId,
        // watermark-style viewer overlay is a web concern; URL is 5-min signed
        signedUrl: await this.storage.signedDocumentUrl(d.storageKey, 300),
      })),
    );
  }

  private async fraudSignals(
    propertyId: string,
    documents: Array<{ sha256: string; documentType: string; ownerUserId: string }>,
    property: { regionId: string; kind: string; areaM2: number | null; priceBaseGbp: unknown },
  ) {
    const signals: string[] = [];

    // same document hash used by other accounts
    for (const doc of documents) {
      const reuse = await this.prisma.document.count({
        where: { sha256: doc.sha256, ownerUserId: { not: doc.ownerUserId }, deletedAt: null },
      });
      if (reuse > 0) signals.push(`${doc.documentType}: same file used by ${reuse} other account(s)`);
    }

    // duplicate photos on other listings (phash)
    const myMedia = await this.prisma.propertyMedia.findMany({
      where: { propertyId, phash: { not: null } },
      select: { phash: true },
    });
    const otherMedia = await this.prisma.propertyMedia.findMany({
      where: { propertyId: { not: propertyId }, phash: { not: null } },
      select: { phash: true, propertyId: true },
      take: 5000,
    });
    const dupListings = new Set<string>();
    for (const mine of myMedia) {
      for (const other of otherMedia) {
        if (MediaService.hammingDistance(mine.phash!, other.phash!) <= 6) dupListings.add(other.propertyId);
      }
    }
    if (dupListings.size > 0) {
      signals.push(`Photos match ${dupListings.size} other listing(s): ${[...dupListings].slice(0, 3).join(', ')}`);
    }

    // price anomaly vs region median price/m² (Plan §4 step 4)
    if (property.areaM2) {
      const peers = await this.prisma.property.findMany({
        where: {
          regionId: property.regionId,
          kind: property.kind as never,
          status: 'live',
          areaM2: { not: null },
          id: { not: propertyId },
        },
        select: { priceBaseGbp: true, areaM2: true },
      });
      const ppm2 = peers
        .map((p) => Number(p.priceBaseGbp) / (p.areaM2 as number))
        .sort((a, b) => a - b);
      if (ppm2.length >= 3) {
        const median = ppm2[Math.floor(ppm2.length / 2)];
        const mine = Number(property.priceBaseGbp) / property.areaM2;
        const deviation = (mine - median) / median;
        if (Math.abs(deviation) > PRICE_ANOMALY_THRESHOLD) {
          signals.push(
            `Price/m² £${Math.round(mine)} deviates ${(deviation * 100).toFixed(0)}% from region median £${Math.round(median)}`,
          );
        }
      }
    }

    return signals;
  }

  // ── decision ─────────────────────────────────────────────────────

  async decide(
    adminId: string,
    itemId: string,
    documentDecisions: DocumentDecision[],
    note: string | undefined,
    ip?: string,
  ) {
    const item = await this.prisma.verificationItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Queue item not found');
    if (item.status === 'approved' || item.status === 'rejected') {
      throw new BadRequestException('Item already decided');
    }

    // apply per-document decisions
    for (const d of documentDecisions) {
      if (d.status === 'rejected' && !d.rejectReasonCode) {
        throw new BadRequestException(`Rejection of ${d.documentId} needs a reason code`);
      }
      await this.prisma.document.update({
        where: { id: d.documentId },
        data: {
          status: d.status,
          rejectReasonCode: d.status === 'rejected' ? d.rejectReasonCode : null,
          rejectNote: d.status === 'rejected' ? (d.rejectNote ?? null) : null,
        },
      });
    }

    const anyRejected = documentDecisions.some((d) => d.status === 'rejected');
    const overall = anyRejected ? 'rejected' : 'approved';

    await this.prisma.verificationItem.update({
      where: { id: itemId },
      data: {
        status: overall,
        claimedByAdminId: adminId,
        decidedAt: new Date(),
        internalNotes: note ? { note } : undefined,
      },
    });

    if (item.entityType === 'listing') {
      await this.applyListingOutcome(item.entityId, overall, documentDecisions);
    } else if (item.entityType === 'profile') {
      await this.applyProfileOutcome(item.entityId, overall);
    }

    await this.audit.log({
      actorId: adminId,
      action: `verification.${overall}`,
      entityType: item.entityType,
      entityId: item.entityId,
      after: { documentDecisions, note } as object,
      ip,
    });

    return { itemId, outcome: overall };
  }

  private async applyListingOutcome(propertyId: string, outcome: string, decisions: DocumentDecision[]) {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { createdByUserId: true, titleI18n: true },
    });
    if (!property) return;
    const title = (property.titleI18n as { en?: string })?.en ?? 'your listing';

    if (outcome === 'approved') {
      await this.prisma.property.update({
        where: { id: propertyId },
        data: { status: 'live', availabilityConfirmedAt: new Date() },
      });
      this.events.emit('listing.live', { propertyId });
      await this.notifications.notify(property.createdByUserId, 'verification.approved', {
        propertyId,
        title,
      });
    } else {
      // stays pending_verification; lister re-uploads only rejected boxes (Plan §4 step 6)
      const rejected = decisions.filter((d) => d.status === 'rejected');
      await this.notifications.notify(property.createdByUserId, 'verification.rejected', {
        propertyId,
        title,
        rejectedCount: rejected.length,
      });
    }
  }

  private async applyProfileOutcome(userRoleId: string, outcome: string) {
    const userRole = await this.prisma.userRole.update({
      where: { id: userRoleId },
      data:
        outcome === 'approved'
          ? { verificationStatus: 'verified', badgeTier: 'verified' }
          : { verificationStatus: 'rejected', badgeTier: 'unverified' },
      include: { role: { select: { key: true } } },
    });
    await this.notifications.notify(
      userRole.userId,
      outcome === 'approved' ? 'profile.verified' : 'profile.rejected',
      { roleKey: userRole.role.key },
    );
  }

  /** Queue metrics (Plan §4 admin dashboard). */
  async metrics() {
    const [depth, overdue, decided] = await Promise.all([
      this.prisma.verificationItem.count({ where: { status: { in: ['queued', 'claimed'] } } }),
      this.prisma.verificationItem.count({
        where: { status: { in: ['queued', 'claimed'] }, slaDueAt: { lt: new Date() } },
      }),
      this.prisma.verificationItem.findMany({
        where: { decidedAt: { not: null } },
        select: { status: true, createdAt: true, decidedAt: true },
        take: 500,
        orderBy: { decidedAt: 'desc' },
      }),
    ]);
    const approvals = decided.filter((d) => d.status === 'approved').length;
    const avgTurnaroundH =
      decided.length > 0
        ? decided.reduce((sum, d) => sum + (d.decidedAt!.getTime() - d.createdAt.getTime()), 0) /
          decided.length /
          3_600_000
        : 0;
    return {
      queueDepth: depth,
      overdue,
      approvalRate: decided.length ? approvals / decided.length : null,
      avgTurnaroundHours: Math.round(avgTurnaroundH * 10) / 10,
    };
  }

  private async entitySummary(entityType: string, entityId: string) {
    if (entityType === 'listing') {
      const p = await this.prisma.property.findUnique({
        where: { id: entityId },
        select: {
          titleI18n: true,
          kind: true,
          region: { select: { slug: true } },
          createdBy: { select: { phone: true, email: true } },
        },
      });
      return p
        ? {
            label: (p.titleI18n as { en?: string })?.en || 'Untitled listing',
            kind: p.kind,
            region: p.region.slug,
            lister: p.createdBy.email ?? p.createdBy.phone,
          }
        : { label: 'Deleted listing' };
    }
    if (entityType === 'profile') {
      const ur = await this.prisma.userRole.findUnique({
        where: { id: entityId },
        select: { role: { select: { key: true } }, user: { select: { phone: true, email: true } } },
      });
      return ur
        ? { label: `${ur.role.key} profile`, lister: ur.user.email ?? ur.user.phone }
        : { label: 'Deleted profile' };
    }
    return { label: entityType };
  }
}
