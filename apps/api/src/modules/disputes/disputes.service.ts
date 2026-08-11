import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DisputeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ReputationService } from '../deals/reputation.service';

const OPEN_STATUSES: DisputeStatus[] = ['open', 'investigating'];
const RESOLUTIONS: DisputeStatus[] = ['resolved_upheld', 'resolved_dismissed', 'investigating'];

/**
 * Dispute centre (Plan §6.7).
 *
 * The `disputes` table has existed since the init migration but nothing ever
 * wrote to it — which meant the `disputeRate` term of the §6.5 ranking score
 * was permanently zero. Resolving a dispute as upheld now recomputes the
 * respondent's reputation, so that term finally means something.
 *
 * Evidence is assembled rather than uploaded: §6.7 defines it as
 * `deal_events + documents + chat export`, all of which the platform already
 * holds, so an admin never has to ask either party for their version.
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reputation: ReputationService,
  ) {}

  /** A party opens a dispute against another party on the same deal. */
  async open(userId: string, dealId: string, againstUserId: string, reason: string, ip?: string) {
    const text = reason?.trim() ?? '';
    if (text.length < 10) {
      throw new BadRequestException('Describe the problem in at least a sentence');
    }

    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      include: { parties: { select: { userId: true } } },
    });
    if (!deal) throw new NotFoundException('Deal not found');

    const partyIds = new Set(deal.parties.map((p) => p.userId));
    if (!partyIds.has(userId)) throw new ForbiddenException('Not a party to this deal');
    if (!partyIds.has(againstUserId)) {
      throw new BadRequestException('You can only dispute another party to this deal');
    }
    if (againstUserId === userId) throw new BadRequestException('You cannot dispute yourself');

    // one open dispute per pair per deal — a second is a comment, not a case
    const existing = await this.prisma.dispute.count({
      where: { dealId, openedBy: userId, againstUserId, status: { in: OPEN_STATUSES } },
    });
    if (existing > 0) throw new BadRequestException('You already have an open dispute on this deal');

    const dispute = await this.prisma.dispute.create({
      data: { dealId, openedBy: userId, againstUserId, reason: text },
    });
    await this.prisma.dealEvent.create({
      data: { dealId, actorId: userId, eventType: 'dispute.opened', payload: { disputeId: dispute.id } },
    });
    await this.notifications.notify(againstUserId, 'deal.stage_advanced', { dealId });
    await this.audit.log({
      actorId: userId,
      action: 'dispute.open',
      entityType: 'dispute',
      entityId: dispute.id,
      after: { dealId, againstUserId },
      ip,
    });
    return this.shape(dispute);
  }

  /** Disputes the caller opened or is answering. */
  async mine(userId: string) {
    const rows = await this.prisma.dispute.findMany({
      where: { OR: [{ openedBy: userId }, { againstUserId: userId }] },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((d) => ({
      ...this.shape(d),
      iOpened: d.openedBy === userId,
    }));
  }

  // ── admin ────────────────────────────────────────────────────────

  async adminList(status?: string) {
    const rows = await this.prisma.dispute.findMany({
      where: status ? { status: status as DisputeStatus } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // oldest open case first
      take: 200,
    });
    const userIds = [...new Set(rows.flatMap((d) => [d.openedBy, d.againstUserId]))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, phone: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((d) => ({
      ...this.shape(d),
      openedByUser: byId.get(d.openedBy) ?? null,
      againstUser: byId.get(d.againstUserId) ?? null,
    }));
  }

  /**
   * The full evidence bundle (§6.7): the immutable deal timeline, every
   * document attached to the deal, and the conversation export.
   */
  async adminDetail(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const [deal, events, documents, conversations, users] = await Promise.all([
      this.prisma.deal.findUnique({
        where: { id: dispute.dealId },
        include: {
          snapshot: true,
          parties: { select: { userId: true, partyRole: true } },
          property: { select: { titleI18n: true } },
        },
      }),
      this.prisma.dealEvent.findMany({
        where: { dealId: dispute.dealId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.dealDocument.findMany({
        where: { dealId: dispute.dealId },
        include: {
          document: {
            select: { id: true, documentType: true, mime: true, size: true, uploadedAt: true, ownerUserId: true },
          },
        },
      }),
      this.prisma.conversation.findMany({
        where: { dealId: dispute.dealId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, senderId: true, body: true, bodyScrubbed: true, createdAt: true },
          },
        },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [dispute.openedBy, dispute.againstUserId] } },
        select: { id: true, phone: true, email: true, status: true },
      }),
    ]);

    const byId = new Map(users.map((u) => [u.id, u]));
    return {
      ...this.shape(dispute),
      openedByUser: byId.get(dispute.openedBy) ?? null,
      againstUser: byId.get(dispute.againstUserId) ?? null,
      deal: deal
        ? {
            id: deal.id,
            kind: deal.kind,
            status: deal.status,
            currentStageKey: deal.currentStageKey,
            title: (deal.property?.titleI18n as { en?: string })?.en ?? null,
            priceAgreed: deal.snapshot ? Number(deal.snapshot.priceAgreed) : null,
            currency: deal.snapshot?.currency ?? null,
            parties: deal.parties,
          }
        : null,
      evidence: {
        events: events.map((e) => ({
          id: e.id, actorId: e.actorId, eventType: e.eventType,
          payload: e.payload, createdAt: e.createdAt,
        })),
        documents: documents.map((d) => ({ stageKey: d.stageKey, ...d.document })),
        // scrubbed messages are exported as stored — the mask is the evidence
        // that a contact-bypass was attempted, so it must not be undone here
        messages: conversations.flatMap((c) => c.messages),
      },
    };
  }

  /**
   * Admin decision. An upheld dispute recomputes the respondent's reputation
   * immediately rather than waiting for the nightly sweep — it is the one
   * ranking input that a person is actively waiting to see applied.
   */
  async resolve(
    adminId: string,
    disputeId: string,
    status: string,
    resolutionNote: string,
    ip?: string,
  ) {
    if (!RESOLUTIONS.includes(status as DisputeStatus)) {
      throw new BadRequestException(`status must be one of ${RESOLUTIONS.join(', ')}`);
    }
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (!OPEN_STATUSES.includes(dispute.status)) {
      throw new BadRequestException(`Dispute is already ${dispute.status}`);
    }
    if (status !== 'investigating' && !resolutionNote?.trim()) {
      throw new BadRequestException('A resolution note is required');
    }

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: status as DisputeStatus,
        resolutionNote: resolutionNote?.trim() || null,
        resolvedByAdminId: status === 'investigating' ? null : adminId,
      },
    });

    if (status === 'resolved_upheld') {
      await this.reputation.recompute(dispute.againstUserId).catch(() => undefined);
    }

    await this.prisma.dealEvent.create({
      data: {
        dealId: dispute.dealId,
        actorId: adminId,
        eventType: 'dispute.resolved',
        payload: { disputeId, status },
      },
    });
    for (const uid of [dispute.openedBy, dispute.againstUserId]) {
      await this.notifications.notify(uid, 'deal.stage_advanced', { dealId: dispute.dealId });
    }
    await this.audit.log({
      actorId: adminId,
      action: 'dispute.resolve',
      entityType: 'dispute',
      entityId: disputeId,
      before: { status: dispute.status },
      after: { status, resolutionNote: resolutionNote?.trim() || null },
      ip,
    });
    return this.shape(updated);
  }

  private shape(d: {
    id: string; dealId: string; openedBy: string; againstUserId: string; reason: string;
    status: DisputeStatus; resolutionNote: string | null; createdAt: Date;
  }) {
    return {
      id: d.id,
      dealId: d.dealId,
      reason: d.reason,
      status: d.status,
      resolutionNote: d.resolutionNote,
      createdAt: d.createdAt,
    };
  }
}
