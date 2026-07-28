import { createHash } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { VERIFICATION_SLA_HOURS } from '@propverify/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaService } from '../media/media.service';
import { SubscriptionsService } from '../marketplace/subscriptions.service';
import { UpdateProjectDto } from './dto/projects.dto';

/** Statuses in which the developer may still edit master info. */
const EDITABLE_STATUSES = ['draft', 'pending_verification', 'live'];
/** Minimum photos before a project can be submitted — same bar as listings. */
const MIN_PROJECT_PHOTOS = 3;

/**
 * Developer projects (Plan §6.3). A project is verified through the same engine
 * as listings (§4) — `verification_requirements` rows with context `project`
 * drive the upload boxes and the admin checklist.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly subscriptions: SubscriptionsService,
    private readonly events: EventEmitter2,
  ) {}

  // ── drafts & editing ─────────────────────────────────────────────

  async createDraft(userId: string, ip?: string) {
    // §13.3: publishing inventory requires an active subscription (admin-granted until Phase 3)
    if (!(await this.subscriptions.hasActive(userId))) {
      throw new ForbiddenException('SUBSCRIPTION_REQUIRED: an active subscription is needed to create projects');
    }
    const region = await this.prisma.region.findFirstOrThrow(); // replaced in the master-info step
    const project = await this.prisma.project.create({
      data: {
        developerUserId: userId,
        nameI18n: { en: '' },
        descriptionI18n: { en: '' },
        regionId: region.id,
        status: 'draft',
      },
    });
    await this.audit.log({
      actorId: userId,
      action: 'project.create_draft',
      entityType: 'project',
      entityId: project.id,
      ip,
    });
    return project;
  }

  async updateDraft(userId: string, projectId: string, dto: UpdateProjectDto, ip?: string) {
    await this.getOwnedEditable(userId, projectId);

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) data.nameI18n = { en: dto.name };
    if (dto.description !== undefined) data.descriptionI18n = { en: dto.description };
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.deliveryDate !== undefined) data.deliveryDate = new Date(dto.deliveryDate);
    if (dto.paymentPlans !== undefined) data.paymentPlans = dto.paymentPlans as unknown as Prisma.InputJsonValue;

    if (dto.regionSlug !== undefined) {
      const region = await this.prisma.region.findUnique({ where: { slug: dto.regionSlug } });
      if (!region) throw new BadRequestException('Unknown region');
      data.region = { connect: { id: region.id } };
    }

    const updated = await this.prisma.project.update({ where: { id: projectId }, data });
    await this.audit.log({
      actorId: userId,
      action: 'project.update',
      entityType: 'project',
      entityId: projectId,
      after: dto as object,
      ip,
    });
    if (updated.status === 'live') this.events.emit('project.updated', { projectId });
    return updated;
  }

  // ── media ────────────────────────────────────────────────────────

  async addPhoto(
    userId: string,
    projectId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    await this.getOwnedEditable(userId, projectId);
    const processed = await this.media.processListingPhoto(file);
    const count = await this.prisma.projectMedia.count({ where: { projectId } });
    const media = await this.prisma.projectMedia.create({
      data: { projectId, type: 'photo', url: processed.url, sortOrder: count },
    });
    if (await this.isLive(projectId)) this.events.emit('project.updated', { projectId });
    return { ...media, thumbUrl: processed.thumbUrl };
  }

  async reorderPhotos(userId: string, projectId: string, mediaIds: string[]) {
    await this.getOwnedEditable(userId, projectId);
    await this.prisma.$transaction(
      mediaIds.map((id, index) =>
        this.prisma.projectMedia.updateMany({ where: { id, projectId }, data: { sortOrder: index } }),
      ),
    );
    return this.prisma.projectMedia.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' } });
  }

  async deletePhoto(userId: string, projectId: string, mediaId: string) {
    await this.getOwnedEditable(userId, projectId);
    await this.prisma.projectMedia.deleteMany({ where: { id: mediaId, projectId } });
    if (await this.isLive(projectId)) this.events.emit('project.updated', { projectId });
    return { ok: true };
  }

  // ── documents (private bucket, Plan §2.4) ────────────────────────

  async addDocument(
    userId: string,
    projectId: string,
    documentType: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    ip?: string,
  ) {
    await this.getOwnedEditable(userId, projectId);
    if (file.size > 20 * 1024 * 1024) throw new BadRequestException('Document exceeds 20MB limit');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = `projects/${projectId}/${documentType}-${Date.now()}`;
    await this.storage.putPrivateDocument(key, file.buffer, file.mimetype);

    const doc = await this.prisma.document.create({
      data: {
        ownerUserId: userId,
        entityType: 'project',
        entityId: projectId,
        documentType,
        storageKey: key,
        mime: file.mimetype,
        size: file.size,
        sha256,
        status: 'pending',
      },
    });

    // re-upload of a rejected doc requeues the project for review (Plan §4 step 6)
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (project?.status === 'pending_verification' || project?.status === 'live') {
      const open = await this.prisma.verificationItem.count({
        where: { entityType: 'project', entityId: projectId, status: { in: ['queued', 'claimed'] } },
      });
      if (open === 0) {
        await this.prisma.verificationItem.create({
          data: {
            entityType: 'project',
            entityId: projectId,
            status: 'queued',
            slaDueAt: new Date(Date.now() + VERIFICATION_SLA_HOURS * 3_600_000),
          },
        });
      }
    }

    await this.audit.log({
      actorId: userId,
      action: 'document.upload',
      entityType: 'document',
      entityId: doc.id,
      after: { projectId, documentType, sha256 },
      ip,
    });
    return { id: doc.id, documentType: doc.documentType, status: doc.status, uploadedAt: doc.uploadedAt };
  }

  async listDocuments(userId: string, projectId: string) {
    await this.assertOwned(userId, projectId);
    return this.prisma.document.findMany({
      where: { entityType: 'project', entityId: projectId, deletedAt: null },
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

  /** Per-project requirement config — drives the upload boxes (Plan §2.2). */
  async getProjectRequirements() {
    return this.prisma.verificationRequirement.findMany({
      where: { context: 'project' },
      select: { documentType: true, isRequired: true, titleI18n: true, helpI18n: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // ── submission ───────────────────────────────────────────────────

  async submit(userId: string, projectId: string, ip?: string) {
    const project = await this.assertOwned(userId, projectId);
    if (project.status !== 'draft') throw new BadRequestException('Only drafts can be submitted');

    const problems: string[] = [];
    if (!(project.nameI18n as { en?: string })?.en) problems.push('Project name is required');
    if (!(project.descriptionI18n as { en?: string })?.en) problems.push('Description is required');
    if (!project.lat || !project.lng) problems.push('Map location is required');
    if (!project.deliveryDate) problems.push('Delivery date is required');

    const [photoCount, unitCount] = await Promise.all([
      this.prisma.projectMedia.count({ where: { projectId } }),
      this.prisma.projectUnit.count({ where: { projectId } }),
    ]);
    if (photoCount < MIN_PROJECT_PHOTOS) {
      problems.push(`At least ${MIN_PROJECT_PHOTOS} photos are required (you have ${photoCount})`);
    }
    if (unitCount === 0) problems.push('Add at least one unit to the inventory');

    const requirements = await this.getProjectRequirements();
    const docs = await this.prisma.document.findMany({
      where: { entityType: 'project', entityId: projectId, deletedAt: null },
      select: { documentType: true },
    });
    const uploadedTypes = new Set(docs.map((d) => d.documentType));
    for (const req of requirements) {
      if (req.isRequired && !uploadedTypes.has(req.documentType)) {
        problems.push(`Missing document: ${(req.titleI18n as { en?: string })?.en ?? req.documentType}`);
      }
    }

    if (problems.length > 0) throw new BadRequestException(problems);

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { status: 'pending_verification' },
    });
    await this.prisma.verificationItem.create({
      data: {
        entityType: 'project',
        entityId: projectId,
        status: 'queued',
        slaDueAt: new Date(Date.now() + VERIFICATION_SLA_HOURS * 3_600_000),
      },
    });
    await this.audit.log({
      actorId: userId,
      action: 'project.submit',
      entityType: 'project',
      entityId: projectId,
      ip,
    });
    return updated;
  }

  // ── reads ────────────────────────────────────────────────────────

  async listMine(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { developerUserId: userId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        region: { select: { slug: true, nameI18n: true } },
        _count: { select: { units: true, updates: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const withStats = await Promise.all(
      projects.map(async (p) => ({ ...p, unitStats: await this.unitStats(p.id) })),
    );
    return withStats;
  }

  /** Public project detail — live projects only, plus the developer's own preview. */
  async getPublic(projectId: string, viewerUserId?: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        region: { select: { slug: true, nameI18n: true, lat: true, lng: true } },
        units: { orderBy: [{ floor: 'asc' }, { unitNo: 'asc' }] },
        updates: { orderBy: { publishedAt: 'desc' }, take: 20 },
        developer: {
          select: {
            id: true,
            developerProfile: { select: { companyName: true, about: true } },
            userRoles: {
              where: { role: { key: 'developer' } },
              select: { badgeTier: true, verificationStatus: true },
            },
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');

    const isDeveloper = viewerUserId === project.developerUserId;
    if (project.status !== 'live' && !isDeveloper) throw new NotFoundException('Project not found');

    const { units, ...rest } = project;
    return {
      ...rest,
      // availability grid: buyers see what is left, never who reserved it
      units: units.map((u) => ({
        id: u.id,
        unitNo: u.unitNo,
        type: u.type,
        bedrooms: u.bedrooms,
        areaM2: u.areaM2,
        floor: u.floor,
        priceAmount: u.priceAmount,
        priceCurrency: u.priceCurrency,
        status: u.status,
      })),
      unitStats: await this.unitStats(projectId),
      isDeveloper,
    };
  }

  /**
   * Public project directory. Unlike listings this is served from Postgres, not
   * Meilisearch: the filters are aggregates over unit inventory (price range,
   * bedrooms still available) that would have to be denormalised into an index,
   * and project cardinality is orders of magnitude below listings.
   */
  async browse(params: { region?: string; minPrice?: number; maxPrice?: number; minBeds?: number }) {
    const projects = await this.prisma.project.findMany({
      where: {
        status: 'live',
        deletedAt: null,
        ...(params.region ? { region: { slug: params.region } } : {}),
        ...(params.minBeds !== undefined
          ? { units: { some: { status: 'available', bedrooms: { gte: params.minBeds } } } }
          : {}),
        ...(params.minPrice !== undefined || params.maxPrice !== undefined
          ? {
              units: {
                some: {
                  status: 'available',
                  priceAmount: {
                    ...(params.minPrice !== undefined ? { gte: params.minPrice } : {}),
                    ...(params.maxPrice !== undefined ? { lte: params.maxPrice } : {}),
                  },
                },
              },
            }
          : {}),
      },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        region: { select: { slug: true, nameI18n: true } },
        developer: { select: { developerProfile: { select: { companyName: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    return Promise.all(
      projects.map(async (p) => ({
        id: p.id,
        name: (p.nameI18n as { en?: string })?.en ?? '',
        region: p.region,
        lat: p.lat,
        lng: p.lng,
        deliveryDate: p.deliveryDate,
        coverUrl: p.media[0]?.url ?? null,
        developerName: p.developer.developerProfile?.companyName ?? null,
        unitStats: await this.unitStats(p.id),
      })),
    );
  }

  /** Developer lead inbox for a project: inquiry threads + unit reservations. */
  async leads(userId: string, projectId: string) {
    await this.assertOwned(userId, projectId);

    const [conversations, deals] = await Promise.all([
      this.prisma.conversation.findMany({
        where: { projectId, dealId: null },
        include: {
          participants: { select: { userId: true, roleInConvo: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.deal.findMany({
        where: { projectUnit: { projectId } },
        include: {
          projectUnit: { select: { id: true, unitNo: true, priceAmount: true, priceCurrency: true } },
          snapshot: { select: { priceAgreed: true, currency: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      inquiries: conversations.map((c) => ({
        conversationId: c.id,
        createdAt: c.createdAt,
        lastMessageAt: c.messages[0]?.createdAt ?? c.createdAt,
        preview: c.messages[0]?.body ?? null,
      })),
      reservations: deals.map((d) => ({
        dealId: d.id,
        status: d.status,
        currentStageKey: d.currentStageKey,
        createdAt: d.createdAt,
        unit: d.projectUnit,
        priceAgreed: d.snapshot?.priceAgreed ?? null,
        currency: d.snapshot?.currency ?? null,
      })),
    };
  }

  /** Availability roll-up used by the grid, cards and the search index. */
  async unitStats(projectId: string) {
    const units = await this.prisma.projectUnit.findMany({
      where: { projectId },
      select: { status: true, priceAmount: true, priceCurrency: true, bedrooms: true },
    });
    const available = units.filter((u) => u.status === 'available');
    const prices = available.map((u) => Number(u.priceAmount));
    return {
      total: units.length,
      available: available.length,
      reserved: units.filter((u) => u.status === 'reserved').length,
      sold: units.filter((u) => u.status === 'sold').length,
      priceFrom: prices.length ? Math.min(...prices) : null,
      priceTo: prices.length ? Math.max(...prices) : null,
      currency: units[0]?.priceCurrency ?? 'GBP',
      bedroomOptions: [...new Set(available.map((u) => u.bedrooms).filter((b): b is number => b !== null))].sort(
        (a, b) => a - b,
      ),
    };
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async isLive(projectId: string) {
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
    return p?.status === 'live';
  }

  /** Shared ownership check — also used by the unit and update services. */
  async assertOwned(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.developerUserId !== userId) {
      throw new ForbiddenException('You do not manage this project');
    }
    return project;
  }

  private async getOwnedEditable(userId: string, projectId: string) {
    const project = await this.assertOwned(userId, projectId);
    if (!EDITABLE_STATUSES.includes(project.status)) {
      throw new BadRequestException(`Project is not editable in status ${project.status}`);
    }
    return project;
  }
}
