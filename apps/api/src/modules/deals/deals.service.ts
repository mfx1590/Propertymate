import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Ordered stage config as stored in pipeline_templates.stages (§7). */
export interface StageDef {
  key: string;
  titleI18n: Record<string, string>;
  requiredDocuments: string[];
  completesBy: string; // buyer | seller | both_parties | lawyer | system | agent_*
  injectableServiceTypes: string[];
  notifications: string[];
  skippable?: boolean;
  createsSnapshot?: boolean;
}

/**
 * The stage at which the deal record is created (everything up to it is done).
 * Keyed by pipeline template key — an off-plan project deal starts at its very
 * first stage because the reservation IS the deal (§6.3).
 */
const CREATION_STAGE: Record<string, string> = {
  purchase: 'offer_accepted',
  rental: 'landlord_approval',
  // project_purchase is deliberately absent: an off-plan deal is created AT its
  // first stage (reservation, still open) rather than after a completed one.
};

/** Completing this stage finalizes the transaction. */
const COMPLETION_STAGE: Record<string, string> = {
  purchase: 'completion',
  rental: 'move_in_checklist',
  project_purchase: 'completion',
};

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Called on offer acceptance. Creates the deal from the pipeline template,
   * freezes the snapshot, seeds parties + stages, opens the deal room, and
   * writes the first immutable event.
   */
  async createFromAcceptedOffer(offerId: string): Promise<string> {
    const offer = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Offer not found');

    const existing = await this.prisma.deal.findFirst({
      where: { propertyId: offer.propertyId, status: { in: ['active', 'completed'] } },
    });
    if (existing) return existing.id; // idempotent

    const property = await this.prisma.property.findUnique({
      where: { id: offer.propertyId },
      include: { media: { orderBy: { sortOrder: 'asc' } }, region: { select: { slug: true, nameI18n: true } } },
    });
    if (!property) throw new NotFoundException('Listing not found');

    const kind: 'purchase' | 'rental' = property.kind === 'rental' ? 'rental' : 'purchase';
    const template = await this.prisma.pipelineTemplate.findUnique({ where: { key: kind } });
    if (!template) throw new BadRequestException(`No pipeline template for ${kind}`);
    const stages = template.stages as unknown as StageDef[];

    const sellerId = property.createdByUserId;
    const agentId = property.publishedByAgentId;

    // snapshot frozen at acceptance (§7)
    const commissionSplit: Prisma.InputJsonValue = {
      listPriceGbp: property.listPriceGbp ? Number(property.listPriceGbp) : null,
      platformProfitGbp: property.platformProfitGbp ? Number(property.platformProfitGbp) : null,
      agentCommissionGbp: property.agentCommissionGbp ? Number(property.agentCommissionGbp) : null,
      ownerAskGbp: Number(property.priceBaseGbp),
    };
    const propertySnapshot: Prisma.InputJsonValue = {
      title: (property.titleI18n as { en?: string })?.en ?? '',
      kind: property.kind,
      region: property.region.slug,
      district: property.district,
      bedrooms: property.bedrooms,
      areaM2: property.areaM2,
      deedType: property.deedType,
      coverUrl: property.media[0]?.url ?? null,
    };

    const creationKey = CREATION_STAGE[kind];
    const creationIdx = stages.findIndex((s) => s.key === creationKey);
    // stages up to & including the creation stage are completed; next is active
    const stageRows = stages.map((s, i) => ({
      stageKey: s.key,
      status:
        creationIdx >= 0 && i <= creationIdx
          ? ('completed' as const)
          : i === creationIdx + 1
            ? ('active' as const)
            : ('pending' as const),
      completedAt: creationIdx >= 0 && i <= creationIdx ? new Date() : null,
    }));
    const currentStageKey = stageRows.find((s) => s.status === 'active')?.stageKey ?? creationKey;

    const parties: { userId: string; partyRole: string }[] = [
      { userId: offer.customerId, partyRole: 'buyer' },
      { userId: sellerId, partyRole: 'seller' },
    ];
    if (agentId && agentId !== sellerId) parties.push({ userId: agentId, partyRole: 'agent_seller_side' });

    const deal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          propertyId: property.id,
          kind,
          status: 'active',
          currentStageKey,
          parties: { create: parties.map((p) => ({ userId: p.userId, partyRole: p.partyRole as never })) },
          stages: { create: stageRows.map((s) => ({ stageKey: s.stageKey, status: s.status, completedAt: s.completedAt })) },
          snapshot: {
            create: {
              propertySnapshot,
              priceAgreed: offer.amount,
              currency: offer.currency,
              commissionSplit,
            },
          },
          events: {
            create: {
              actorId: offer.customerId,
              eventType: 'deal.created',
              payload: { offerId, priceAgreed: Number(offer.amount), currency: offer.currency } as Prisma.InputJsonValue,
            },
          },
        },
      });

      // deal room: reuse existing property conversation participants or make one
      await tx.conversation.create({
        data: {
          propertyId: property.id,
          dealId: created.id,
          participants: {
            create: parties.map((p) => ({
              userId: p.userId,
              roleInConvo: p.partyRole === 'buyer' ? 'buyer' : 'seller_side',
            })),
          },
        },
      });
      return created;
    });

    for (const p of parties) {
      await this.notifications.notify(p.userId, 'deal.created', {
        dealId: deal.id,
        title: propertySnapshot['title' as keyof typeof propertySnapshot],
      });
    }
    await this.audit.log({
      actorId: offer.customerId,
      action: 'deal.created',
      entityType: 'deal',
      entityId: deal.id,
      after: { propertyId: property.id, kind, priceAgreed: Number(offer.amount) },
    });
    return deal.id;
  }

  /**
   * Off-plan reservation (§6.3): reserving an available unit IS the deal. It is
   * created at the still-open `reservation` stage, which the developer completes
   * once the reservation is honoured, and the unit is held as `reserved`.
   */
  async createFromUnitReservation(customerId: string, unitId: string, ip?: string): Promise<string> {
    const unit = await this.prisma.projectUnit.findUnique({
      where: { id: unitId },
      include: {
        project: {
          include: {
            region: { select: { slug: true } },
            media: { orderBy: { sortOrder: 'asc' }, take: 1 },
          },
        },
      },
    });
    if (!unit || unit.project.deletedAt) throw new NotFoundException('Unit not found');
    if (unit.project.status !== 'live') throw new BadRequestException('Project is not published');
    if (unit.project.developerUserId === customerId) {
      throw new BadRequestException('You cannot reserve a unit in your own project');
    }

    const existing = await this.prisma.deal.findFirst({
      where: { projectUnitId: unitId, status: { in: ['active', 'completed'] } },
    });
    if (existing) throw new BadRequestException('This unit is already reserved');
    if (unit.status !== 'available') throw new BadRequestException(`Unit is ${unit.status}`);

    const template = await this.prisma.pipelineTemplate.findUnique({ where: { key: 'project_purchase' } });
    if (!template) throw new BadRequestException('No pipeline template for project_purchase');
    const stages = template.stages as unknown as StageDef[];

    const developerId = unit.project.developerUserId;
    const propertySnapshot: Prisma.InputJsonValue = {
      title: `${(unit.project.nameI18n as { en?: string })?.en ?? 'Project'} — unit ${unit.unitNo}`,
      kind: 'project_unit',
      region: unit.project.region.slug,
      unitNo: unit.unitNo,
      unitType: unit.type,
      bedrooms: unit.bedrooms,
      areaM2: unit.areaM2,
      floor: unit.floor,
      deliveryDate: unit.project.deliveryDate,
      coverUrl: unit.project.media[0]?.url ?? null,
      projectId: unit.projectId,
    };
    const commissionSplit: Prisma.InputJsonValue = {
      developerSale: true,
      unitPrice: Number(unit.priceAmount),
      currency: unit.priceCurrency,
      paymentPlans: (unit.project.paymentPlans as Prisma.InputJsonValue) ?? null,
    };

    const deal = await this.prisma.$transaction(async (tx) => {
      const created = await tx.deal.create({
        data: {
          projectUnitId: unitId,
          kind: 'purchase',
          status: 'active',
          currentStageKey: stages[0].key,
          parties: {
            create: [
              { userId: customerId, partyRole: 'buyer' },
              { userId: developerId, partyRole: 'seller' },
            ],
          },
          stages: {
            create: stages.map((s, i) => ({
              stageKey: s.key,
              status: i === 0 ? ('active' as const) : ('pending' as const),
            })),
          },
          snapshot: {
            create: {
              propertySnapshot,
              priceAgreed: unit.priceAmount,
              currency: unit.priceCurrency,
              commissionSplit,
            },
          },
          events: {
            create: {
              actorId: customerId,
              eventType: 'deal.created',
              payload: { unitId, projectId: unit.projectId, priceAgreed: Number(unit.priceAmount) } as Prisma.InputJsonValue,
            },
          },
        },
      });
      await tx.projectUnit.update({ where: { id: unitId }, data: { status: 'reserved' } });
      await tx.conversation.create({
        data: {
          projectId: unit.projectId,
          dealId: created.id,
          participants: {
            create: [
              { userId: customerId, roleInConvo: 'buyer' },
              { userId: developerId, roleInConvo: 'seller_side' },
            ],
          },
        },
      });
      return created;
    });

    for (const userId of [customerId, developerId]) {
      await this.notifications.notify(userId, 'deal.created', {
        dealId: deal.id,
        title: propertySnapshot['title' as keyof typeof propertySnapshot],
      });
    }
    await this.audit.log({
      actorId: customerId,
      action: 'deal.created',
      entityType: 'deal',
      entityId: deal.id,
      after: { unitId, projectId: unit.projectId, priceAgreed: Number(unit.priceAmount) },
      ip,
    });
    return deal.id;
  }

  async listMine(userId: string) {
    const deals = await this.prisma.deal.findMany({
      where: { parties: { some: { userId } } },
      include: {
        snapshot: true,
        stages: { orderBy: { id: 'asc' } },
        property: { select: { id: true, titleI18n: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } } },
        projectUnit: {
          select: {
            id: true,
            unitNo: true,
            project: { select: { id: true, nameI18n: true, media: { take: 1, orderBy: { sortOrder: 'asc' } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return deals.map((d) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
      currentStageKey: d.currentStageKey,
      property: d.property,
      projectUnit: d.projectUnit,
      snapshot: d.snapshot,
      progress: {
        completed: d.stages.filter((s) => s.status === 'completed' || s.status === 'skipped').length,
        total: d.stages.length,
      },
    }));
  }

  async getDeal(userId: string, dealId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: {
        snapshot: true,
        parties: true,
        stages: { orderBy: { id: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        property: { select: { id: true, kind: true } },
        projectUnit: {
          select: { id: true, unitNo: true, project: { select: { id: true, nameI18n: true } } },
        },
        conversations: { select: { id: true } },
      },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    const myParty = deal.parties.find((p) => p.userId === userId);
    if (!myParty && !(await this.isAdmin(userId))) {
      throw new ForbiddenException('Not a party to this deal');
    }

    const { stages: stageDefs } = await this.pipelineFor(deal);
    const docs = await this.prisma.dealDocument.findMany({
      where: { dealId },
      include: { document: { select: { id: true, documentType: true, uploadedAt: true } } },
    });

    return {
      ...deal,
      myPartyRole: myParty?.partyRole ?? null,
      stageDefs,
      documents: docs,
    };
  }

  /** Complete the current stage and advance the pipeline. */
  async advanceStage(userId: string, dealId: string, note?: string, ip?: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { parties: true, stages: true },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.status !== 'active') throw new BadRequestException('Deal is not active');

    // §6.7 full workflow: a deal pauses while an admin is actively
    // investigating a dispute on it — completing a disputed sale would decide
    // the case by fait accompli. Deliberately keyed on `investigating`, NOT
    // `open`: an open dispute is one click, and freezing on it would hand
    // every party a veto over the other's deal. The admin escalates, the
    // admin's decision unfreezes. Queried directly, the contracts-gate
    // precedent — disputes already depends on deals.
    const investigating = await this.prisma.dispute.count({
      where: { dealId, status: 'investigating' },
    });
    if (investigating > 0) {
      throw new BadRequestException(
        'This deal is paused while a dispute on it is investigated. It resumes when the case is decided.',
      );
    }

    const { templateKey, stages } = await this.pipelineFor(deal);
    const curIdx = stages.findIndex((s) => s.key === deal.currentStageKey);
    if (curIdx < 0) throw new BadRequestException('Current stage not found in template');
    const cur = stages[curIdx];

    await this.assertCanComplete(userId, deal.parties, cur);
    await this.assertRequiredDocs(dealId, cur);
    await this.assertContractsSigned(dealId);

    const isCompletion = cur.key === COMPLETION_STAGE[templateKey];

    await this.prisma.$transaction(async (tx) => {
      await tx.dealStage.updateMany({
        where: { dealId, stageKey: cur.key },
        data: { status: 'completed', completedAt: new Date(), completedBy: userId },
      });
      await tx.dealEvent.create({
        data: {
          dealId,
          actorId: userId,
          eventType: 'stage.completed',
          payload: { stageKey: cur.key, note: note ?? null } as Prisma.InputJsonValue,
        },
      });

      if (isCompletion) {
        await tx.deal.update({ where: { id: dealId }, data: { status: 'completed', completedAt: new Date() } });
        if (deal.propertyId) {
          await tx.property.update({
            where: { id: deal.propertyId },
            data: { status: deal.kind === 'rental' ? 'rented' : 'sold' },
          });
        }
        if (deal.projectUnitId) {
          await tx.projectUnit.update({ where: { id: deal.projectUnitId }, data: { status: 'sold' } });
        }
        await tx.dealEvent.create({ data: { dealId, actorId: userId, eventType: 'deal.completed' } });
      } else {
        // advance to next non-skipped stage
        const next = stages[curIdx + 1];
        if (next) {
          await tx.dealStage.updateMany({ where: { dealId, stageKey: next.key }, data: { status: 'active' } });
          await tx.deal.update({ where: { id: dealId }, data: { currentStageKey: next.key } });
        }
      }
    });

    await this.audit.log({
      actorId: userId,
      action: isCompletion ? 'deal.completed' : 'deal.stage_advanced',
      entityType: 'deal',
      entityId: dealId,
      after: { stageKey: cur.key },
      ip,
    });

    for (const p of deal.parties) {
      await this.notifications.notify(
        p.userId,
        isCompletion ? 'deal.completed' : 'deal.stage_advanced',
        { dealId },
      );
    }
    if (isCompletion) this.events.emit('deal.completed', { dealId });
    return this.getDeal(userId, dealId);
  }

  /** Skip a skippable stage (e.g. permit_process for non-foreign buyers). */
  async skipStage(userId: string, dealId: string, ip?: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId }, include: { parties: true } });
    if (!deal) throw new NotFoundException('Deal not found');
    if (!deal.parties.some((p) => p.userId === userId) && !(await this.isAdmin(userId))) {
      throw new ForbiddenException('Not a party to this deal');
    }
    const { stages } = await this.pipelineFor(deal);
    const curIdx = stages.findIndex((s) => s.key === deal.currentStageKey);
    const cur = stages[curIdx];
    if (!cur?.skippable) throw new BadRequestException('This stage cannot be skipped');

    await this.prisma.$transaction(async (tx) => {
      await tx.dealStage.updateMany({ where: { dealId, stageKey: cur.key }, data: { status: 'skipped', completedAt: new Date() } });
      await tx.dealEvent.create({ data: { dealId, actorId: userId, eventType: 'stage.skipped', payload: { stageKey: cur.key } } });
      const next = stages[curIdx + 1];
      if (next) {
        await tx.dealStage.updateMany({ where: { dealId, stageKey: next.key }, data: { status: 'active' } });
        await tx.deal.update({ where: { id: dealId }, data: { currentStageKey: next.key } });
      }
    });
    return this.getDeal(userId, dealId);
  }

  /** Attach a document (deposit receipt, signed contract…) to the current stage. */
  async attachDocument(
    userId: string,
    dealId: string,
    documentType: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    ip?: string,
  ) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId }, include: { parties: true } });
    if (!deal) throw new NotFoundException('Deal not found');
    if (!deal.parties.some((p) => p.userId === userId)) throw new ForbiddenException('Not a party to this deal');
    if (file.size > 20 * 1024 * 1024) throw new BadRequestException('Document exceeds 20MB limit');

    const { createHash } = await import('crypto');
    const key = `deals/${dealId}/${documentType}-${Date.now()}`;
    await this.storage.putPrivateDocument(key, file.buffer, file.mimetype);
    const doc = await this.prisma.document.create({
      data: {
        ownerUserId: userId,
        entityType: 'deal',
        entityId: dealId,
        documentType,
        storageKey: key,
        mime: file.mimetype,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        status: 'approved', // deal-room docs are party-supplied evidence, not admin-verified
      },
    });
    await this.prisma.dealDocument.create({
      data: { dealId, documentId: doc.id, stageKey: deal.currentStageKey },
    });
    await this.prisma.dealEvent.create({
      data: { dealId, actorId: userId, eventType: 'document.attached', payload: { documentType, stageKey: deal.currentStageKey } },
    });
    await this.audit.log({
      actorId: userId,
      action: 'deal.document_attached',
      entityType: 'deal',
      entityId: dealId,
      after: { documentType },
      ip,
    });
    return { id: doc.id, documentType, stageKey: deal.currentStageKey };
  }

  // ── helpers ──────────────────────────────────────────────────────

  /**
   * Which pipeline drives this deal. A project-unit deal is still `kind=purchase`
   * but runs the off-plan template, so the template is chosen by key, not kind.
   */
  /**
   * The stage a deal is sitting on right now, with its config.
   *
   * Public because §2.2 declares service-provider injection points ON the stage,
   * and the modules that inject into them (legal first, the other lateral
   * services after it) have to read that config rather than re-deriving which
   * pipeline template a deal runs — two answers to "which template" is how the
   * off-plan refactor nearly went wrong.
   */
  async currentStageDef(dealId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: { id: true, kind: true, projectUnitId: true, currentStageKey: true, status: true },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    const { stages } = await this.pipelineFor(deal);
    return {
      deal,
      stageKey: deal.currentStageKey,
      def: stages.find((s) => s.key === deal.currentStageKey) ?? null,
      stages,
    };
  }

  /**
   * The human name a notification calls a deal — property title, or project +
   * unit for off-plan. Public because legal (step 23) and disputes (step 26)
   * both need it, and the off-plan half was already forgotten once (the
   * lawyer-inbox "this property" defect).
   */
  async dealTitle(dealId: string): Promise<string> {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: {
        property: { select: { titleI18n: true } },
        projectUnit: { select: { unitNo: true, project: { select: { nameI18n: true } } } },
      },
    });
    const nameOf = (i18n: unknown) => {
      const t = (i18n ?? {}) as Record<string, string>;
      return t.en || Object.values(t)[0] || 'this property';
    };
    if (deal?.property) return nameOf(deal.property.titleI18n);
    if (deal?.projectUnit) {
      return `${nameOf(deal.projectUnit.project.nameI18n)} — ${deal.projectUnit.unitNo}`;
    }
    return 'this property';
  }

  private async pipelineFor(deal: { kind: string; projectUnitId: string | null }) {
    const templateKey = deal.projectUnitId ? 'project_purchase' : deal.kind;
    const template = await this.prisma.pipelineTemplate.findUnique({ where: { key: templateKey } });
    return { templateKey, stages: (template?.stages as unknown as StageDef[]) ?? [] };
  }

  private async assertCanComplete(
    userId: string,
    parties: { userId: string; partyRole: string }[],
    stage: StageDef,
  ) {
    if (stage.completesBy === 'system') return; // auto stages never advanced manually here
    const myRoles = parties.filter((p) => p.userId === userId).map((p) => p.partyRole);
    if (myRoles.length === 0 && !(await this.isAdmin(userId))) {
      throw new ForbiddenException('Not a party to this deal');
    }
    const sellerSide = ['seller', 'agent_seller_side'];
    const buyerSide = ['buyer', 'agent_buyer_side'];

    const allowed =
      stage.completesBy === 'both_parties' ||
      (stage.completesBy === 'seller' && myRoles.some((r) => sellerSide.includes(r))) ||
      (stage.completesBy === 'buyer' && myRoles.some((r) => buyerSide.includes(r))) ||
      myRoles.includes(stage.completesBy) ||
      (await this.isAdmin(userId));
    if (!allowed) {
      throw new ForbiddenException(`This stage is completed by ${stage.completesBy}`);
    }
  }

  /**
   * A generated contract that is still waiting on a signature blocks the deal
   * (Plan §7 "both e-sign"). Queried directly rather than through
   * ContractsService so the deals module keeps no dependency on contracts —
   * contracts already depends on deals.
   */
  private async assertContractsSigned(dealId: string) {
    const unsigned = await this.prisma.contract.count({
      where: { dealId, status: 'awaiting_signatures' },
    });
    if (unsigned > 0) {
      throw new BadRequestException('The contract is not fully signed yet');
    }
  }

  private async assertRequiredDocs(dealId: string, stage: StageDef) {
    if (!stage.requiredDocuments?.length) return;
    const attached = await this.prisma.dealDocument.findMany({
      where: { dealId, stageKey: stage.key },
      include: { document: { select: { documentType: true } } },
    });
    const have = new Set(attached.map((a) => a.document.documentType));
    const missing = stage.requiredDocuments.filter((d) => !have.has(d));
    if (missing.length > 0) {
      throw new BadRequestException(`Attach required documents first: ${missing.join(', ')}`);
    }
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const count = await this.prisma.userRole.count({
      where: { userId, role: { key: 'admin' } },
    });
    return count > 0;
  }
}
