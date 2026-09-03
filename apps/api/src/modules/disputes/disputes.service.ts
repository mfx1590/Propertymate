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
import { DealsService } from '../deals/deals.service';

const OPEN_STATUSES: DisputeStatus[] = ['open', 'investigating'];
const RESOLUTIONS: DisputeStatus[] = ['resolved_upheld', 'resolved_dismissed', 'investigating'];

/** A statement is a paragraph or three, not a filing cabinet. */
const MAX_STATEMENT = 4000;

/**
 * Dispute centre (Plan §6.7; full workflow, §10.2 Phase 3, step 26).
 *
 * Step 9 built the spine: a party opens a case, the platform assembles the
 * evidence it already holds (deal timeline + documents + chat export), an
 * admin decides, and an upheld case recomputes the respondent's reputation.
 * That principle stands — nobody is ever asked to submit "their evidence".
 *
 * What step 26 adds is the workflow around that spine:
 *   - the respondent can BE HEARD — statements, visible to everyone on the
 *     case, because a case has no privileged side-channel
 *   - the opener can withdraw a case that life resolved, instead of an admin
 *     having to adjudicate a complaint nobody maintains
 *   - escalating to `investigating` pauses the deal (enforced in
 *     DealsService), and the decision resumes it
 *   - every event notifies through its own `dispute.*` template — until now a
 *     person accused of misconduct was told "deal stage advanced", which is
 *     the single worst notification this platform has ever sent
 */
@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly reputation: ReputationService,
    private readonly deals: DealsService,
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
    await this.notifications.notify(againstUserId, 'dispute.opened', {
      title: await this.deals.dealTitle(dealId),
    });
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

  /** Disputes the caller opened or is answering, newest first. */
  async mine(userId: string) {
    const rows = await this.prisma.dispute.findMany({
      where: { OR: [{ openedBy: userId }, { againstUserId: userId }] },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { statements: true } } },
    });
    const titles = new Map<string, string>();
    for (const d of rows) {
      if (!titles.has(d.dealId)) titles.set(d.dealId, await this.deals.dealTitle(d.dealId));
    }
    return rows.map((d) => ({
      ...this.shape(d),
      iOpened: d.openedBy === userId,
      dealTitle: titles.get(d.dealId) ?? 'this property',
      statementCount: d._count.statements,
    }));
  }

  /**
   * One case, as a party sees it: status, reason, the statement thread, and
   * the decision once there is one. The assembled evidence bundle is NOT here
   * — it contains the counterparty's documents and both sides' full chat, and
   * §2.4 scopes those to the deal room and the admin, not to whoever files a
   * complaint.
   */
  async detailForParty(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { statements: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.openedBy !== userId && dispute.againstUserId !== userId) {
      throw new ForbiddenException('Not your dispute');
    }
    return {
      ...this.shape(dispute),
      iOpened: dispute.openedBy === userId,
      dealTitle: await this.deals.dealTitle(dispute.dealId),
      statements: dispute.statements.map((s) => ({
        id: s.id,
        mine: s.authorUserId === userId,
        byAdmin: s.byAdmin,
        body: s.body,
        createdAt: s.createdAt,
      })),
    };
  }

  /**
   * Add a statement. Parties may speak while the case is open or under
   * investigation; once decided, the case is closed — reopening an argument
   * under a decided case would just be a slower chat thread.
   */
  async addStatement(userId: string, disputeId: string, body: string, opts: { asAdmin?: boolean } = {}, ip?: string) {
    const text = body?.trim() ?? '';
    if (text.length < 2) throw new BadRequestException('Statement is empty');
    if (text.length > MAX_STATEMENT) {
      throw new BadRequestException(`A statement is limited to ${MAX_STATEMENT} characters`);
    }

    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    const isParty = dispute.openedBy === userId || dispute.againstUserId === userId;
    if (!opts.asAdmin && !isParty) throw new ForbiddenException('Not your dispute');
    if (!OPEN_STATUSES.includes(dispute.status)) {
      throw new BadRequestException('This case is decided — statements are closed');
    }

    const statement = await this.prisma.disputeStatement.create({
      data: { disputeId, authorUserId: userId, byAdmin: !!opts.asAdmin, body: text },
    });

    // Tell everyone on the case except the author. An admin's question reaches
    // both sides; a party's statement reaches the other party.
    const title = await this.deals.dealTitle(dispute.dealId);
    const recipients = new Set([dispute.openedBy, dispute.againstUserId]);
    recipients.delete(userId);
    for (const uid of recipients) {
      await this.notifications.notify(uid, 'dispute.statement_added', { title });
    }

    await this.audit.log({
      actorId: userId,
      action: 'dispute.statement',
      entityType: 'dispute',
      entityId: disputeId,
      after: { byAdmin: !!opts.asAdmin, length: text.length },
      ip,
    });
    return { id: statement.id, createdAt: statement.createdAt };
  }

  /**
   * The opener takes their case back — but only while it is merely `open`.
   * Once an admin is investigating, the case belongs to the platform: a
   * withdrawal under investigation is indistinguishable from a withdrawal
   * under pressure, and the §13.2 premise is that leverage like that must not
   * work here. The admin can still dismiss it in one click.
   */
  async withdraw(userId: string, disputeId: string, ip?: string) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    if (dispute.openedBy !== userId) throw new ForbiddenException('Only the person who opened a dispute can withdraw it');
    if (dispute.status === 'investigating') {
      throw new BadRequestException(
        'This case is under investigation and can no longer be withdrawn — the admin will decide it',
      );
    }
    if (dispute.status !== 'open') {
      throw new BadRequestException(`Dispute is already ${dispute.status}`);
    }

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'withdrawn' },
    });
    await this.prisma.dealEvent.create({
      data: {
        dealId: dispute.dealId,
        actorId: userId,
        eventType: 'dispute.withdrawn',
        payload: { disputeId },
      },
    });
    await this.notifications.notify(dispute.againstUserId, 'dispute.withdrawn', {
      title: await this.deals.dealTitle(dispute.dealId),
    });
    await this.audit.log({
      actorId: userId,
      action: 'dispute.withdraw',
      entityType: 'dispute',
      entityId: disputeId,
      ip,
    });
    return this.shape(updated);
  }

  // ── admin ────────────────────────────────────────────────────────

  async adminList(status?: string) {
    const rows = await this.prisma.dispute.findMany({
      where: status ? { status: status as DisputeStatus } : {},
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }], // oldest open case first
      take: 200,
      include: { _count: { select: { statements: true } } },
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
      statementCount: d._count.statements,
    }));
  }

  /**
   * The full evidence bundle (§6.7): the immutable deal timeline, every
   * document attached to the deal, the conversation export — and now the
   * statement thread, which is the parties' own words on the record.
   */
  async adminDetail(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { statements: { orderBy: { createdAt: 'asc' } } },
    });
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
      statements: dispute.statements.map((s) => ({
        id: s.id,
        authorUserId: s.authorUserId,
        byAdmin: s.byAdmin,
        body: s.body,
        createdAt: s.createdAt,
      })),
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
   * Admin decision. Escalating to `investigating` pauses the deal (the gate
   * lives in DealsService.advanceStage) and both parties are told the deal is
   * held; either resolution releases it and each party gets the SAME neutral
   * sentence — which template fires carries the outcome, never an English
   * word in a payload rendered per-locale later.
   *
   * An upheld dispute recomputes the respondent's reputation immediately
   * rather than waiting for the nightly sweep — it is the one ranking input a
   * person is actively waiting to see applied.
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
    if (status === 'investigating' && dispute.status === 'investigating') {
      throw new BadRequestException('Already under investigation');
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
        eventType: status === 'investigating' ? 'dispute.investigating' : 'dispute.resolved',
        payload: { disputeId, status },
      },
    });

    const title = await this.deals.dealTitle(dispute.dealId);
    const templateKey =
      status === 'investigating'
        ? 'dispute.investigating'
        : status === 'resolved_upheld'
          ? 'dispute.upheld'
          : 'dispute.dismissed';
    for (const uid of [dispute.openedBy, dispute.againstUserId]) {
      await this.notifications.notify(uid, templateKey, { title });
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
