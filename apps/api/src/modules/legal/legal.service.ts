import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DealsService } from '../deals/deals.service';
import { QuoteDto, RequestQuotesDto } from './dto/legal.dto';

/** The service type this module activates. The rest of §2.2 stays a seam. */
const SERVICE_TYPE = 'lawyer' as const;

/** How many lawyers one party may have open requests with on one deal. */
const MAX_OPEN_REQUESTS = 5;

/** Statuses a request is still live in — anything else is finished business. */
const OPEN_STATUSES = ['requested', 'quoted'] as const;

/**
 * The lawyer marketplace (Plan §10.2 Phase 3, first item).
 *
 * Three things, one module: a directory of verified lawyers, a quote request
 * that can only be made where the pipeline says a lawyer may attach, and the
 * acceptance that puts one in the deal room.
 *
 * **The engagement belongs to the requester, not the deal.** Buyer and seller
 * each engage their own lawyer, because a single shared one is a conflict of
 * interest in a conveyance — so accepting a quote grants access to the room but
 * never lets one side's lawyer act for the other, and every listing method
 * below is scoped by who is asking.
 */
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly deals: DealsService,
  ) {}

  // ── directory ────────────────────────────────────────────────────

  /**
   * Verified lawyers only. Public, unlike the find-my-agent directory: that one
   * is a step inside the private resale flow (§13.4), whereas this is a
   * marketplace whose whole purpose is that a buyer can see who is on it before
   * they have a deal — often before they have an account.
   */
  async directory(regionSlug?: string, language?: string) {
    const rows = await this.prisma.userRole.findMany({
      where: { verificationStatus: 'verified', role: { key: SERVICE_TYPE } },
      select: {
        user: {
          select: {
            id: true,
            lawyerProfile: true,
            _count: {
              select: {
                legalEngagementsAsLawyer: { where: { status: 'accepted' } },
              },
            },
          },
        },
      },
    });

    return rows
      .map((r) => this.publicShape(r.user))
      // An empty list means "everywhere", the same convention the agent
      // directory uses — a lawyer who names no regions is not hidden by a
      // region filter, they are simply not restricted.
      .filter((l) => !regionSlug || l.regions.length === 0 || l.regions.includes(regionSlug))
      .filter((l) => !language || l.languages.length === 0 || l.languages.includes(language))
      // Accepted engagements on this platform, and nothing else. It is a thin
      // signal, but it is one we can actually stand behind — unlike the §6.5
      // ranking score, which is computed from listing-side inputs that say
      // nothing about legal work.
      .sort((a, b) => b.engagementCount - a.engagementCount);
  }

  async publicProfile(userId: string) {
    const role = await this.prisma.userRole.findFirst({
      where: { userId, verificationStatus: 'verified', role: { key: SERVICE_TYPE } },
      select: {
        user: {
          select: {
            id: true,
            lawyerProfile: true,
            _count: {
              select: { legalEngagementsAsLawyer: { where: { status: 'accepted' } } },
            },
          },
        },
      },
    });
    if (!role) throw new NotFoundException('Lawyer not found');
    return this.publicShape(role.user);
  }

  /**
   * What leaves the API for a lawyer. Phone, email and the bar-licence document
   * are deliberately absent: verification is the platform's job and its result
   * is the badge, not the paperwork behind it (§13.4 anonymity, §2.4 documents).
   */
  private publicShape(user: {
    id: string;
    lawyerProfile: {
      firmName: string | null;
      barNo: string | null;
      bio: string | null;
      regions: string[];
      languages: string[];
      feeModel: string | null;
      feeNote: string | null;
    } | null;
    _count: { legalEngagementsAsLawyer: number };
  }) {
    const p = user.lawyerProfile;
    return {
      userId: user.id,
      name: p?.firmName?.trim() || 'Lawyer',
      bio: p?.bio ?? null,
      regions: p?.regions ?? [],
      languages: p?.languages ?? [],
      feeModel: p?.feeModel ?? null,
      feeNote: p?.feeNote ?? null,
      engagementCount: user._count.legalEngagementsAsLawyer,
    };
  }

  // ── requesting a quote ───────────────────────────────────────────

  /**
   * Ask up to `MAX_OPEN_REQUESTS` lawyers to quote on this deal.
   *
   * The gate is the pipeline stage, read from the template rather than
   * hard-coded: §2.2 says the stage config declares which service types may
   * attach where, and this is the first code in the project to actually consult
   * that declaration. On the purchase pipelines `lawyer` is injectable at
   * `legal_check`, `contract_signing` and `permit_process`; on the rental one it
   * is injectable nowhere, so a tenancy correctly refuses — that is config
   * speaking, not a rule written here.
   */
  async requestQuotes(userId: string, dealId: string, dto: RequestQuotesDto, ip?: string) {
    const lawyerUserIds = [...new Set(dto.lawyerUserIds ?? [])];
    if (lawyerUserIds.length === 0) throw new BadRequestException('Pick at least one lawyer');

    const { deal, stageKey, def, stages } = await this.deals.currentStageDef(dealId);
    if (deal.status !== 'active') throw new BadRequestException('This deal is no longer active');

    await this.assertParty(userId, dealId);

    if (!def?.injectableServiceTypes?.includes(SERVICE_TYPE)) {
      const allowed = stages
        .filter((s) => s.injectableServiceTypes?.includes(SERVICE_TYPE))
        .map((s) => s.key);
      throw new BadRequestException(
        allowed.length
          ? `A lawyer cannot be engaged at the "${stageKey}" stage. Stages that allow one: ${allowed.join(', ')}.`
          : `This deal's pipeline has no stage at which a lawyer attaches.`,
      );
    }

    const open = await this.prisma.legalEngagement.count({
      where: { dealId, requestedByUserId: userId, status: { in: [...OPEN_STATUSES] } },
    });
    if (open + lawyerUserIds.length > MAX_OPEN_REQUESTS) {
      throw new BadRequestException(
        `You can have at most ${MAX_OPEN_REQUESTS} open quote requests on a deal (${open} already open)`,
      );
    }

    const already = await this.prisma.legalEngagement.findFirst({
      where: { dealId, requestedByUserId: userId, status: 'accepted' },
    });
    if (already) throw new BadRequestException('You have already engaged a lawyer on this deal');

    const verified = await this.prisma.userRole.findMany({
      where: {
        userId: { in: lawyerUserIds },
        verificationStatus: 'verified',
        role: { key: SERVICE_TYPE },
      },
      select: { userId: true },
    });
    const verifiedIds = new Set(verified.map((v) => v.userId));
    const unknown = lawyerUserIds.filter((id) => !verifiedIds.has(id));
    if (unknown.length) {
      throw new BadRequestException(`Not a verified lawyer: ${unknown.join(', ')}`);
    }
    if (lawyerUserIds.includes(userId)) {
      throw new BadRequestException('You cannot engage yourself');
    }

    const title = await this.dealTitle(dealId);
    const created = [];
    for (const lawyerUserId of lawyerUserIds) {
      // The unique key is (deal, lawyer, requester), so re-asking the same
      // lawyer after they declined reopens the same row rather than failing —
      // circumstances change, and a dead row should not block a second ask.
      const engagement = await this.prisma.legalEngagement.upsert({
        where: {
          dealId_lawyerUserId_requestedByUserId: { dealId, lawyerUserId, requestedByUserId: userId },
        },
        update: {
          status: 'requested',
          stageKey,
          scope: dto.scope ?? null,
          quoteAmount: null,
          quoteCurrency: null,
          quoteNote: null,
          quotedAt: null,
          respondedAt: null,
        },
        create: {
          dealId,
          lawyerUserId,
          requestedByUserId: userId,
          stageKey,
          scope: dto.scope ?? null,
        },
      });
      created.push(engagement);
      await this.notifications.notify(lawyerUserId, 'legal.quote_requested', { title });
    }

    await this.audit.log({
      actorId: userId,
      action: 'legal.quotes_requested',
      entityType: 'deal',
      entityId: dealId,
      after: { stageKey, lawyerUserIds },
      ip,
    });

    return created;
  }

  // ── reading ──────────────────────────────────────────────────────

  /**
   * Engagements on this deal that the caller is entitled to see: the ones they
   * requested, plus any they are the lawyer on. A party never sees the other
   * side's quotes — what the seller is paying their lawyer is not the buyer's
   * business, and vice versa.
   */
  async forDeal(userId: string, dealId: string) {
    await this.assertParty(userId, dealId, { allowLawyer: true });
    const rows = await this.prisma.legalEngagement.findMany({
      where: {
        dealId,
        OR: [{ requestedByUserId: userId }, { lawyerUserId: userId }],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        lawyer: { select: { id: true, lawyerProfile: { select: { firmName: true } } } },
      },
    });
    return rows.map((r) => this.engagementShape(r, userId));
  }

  /** A lawyer's own request inbox. */
  async inbox(lawyerUserId: string, status?: string) {
    const rows = await this.prisma.legalEngagement.findMany({
      where: { lawyerUserId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        lawyer: { select: { id: true, lawyerProfile: { select: { firmName: true } } } },
        deal: {
          select: {
            id: true,
            kind: true,
            currentStageKey: true,
            status: true,
            property: { select: { titleI18n: true } },
            // An off-plan deal has no property row — it hangs off a project
            // unit. Without this the whole inbox reads "this property" for
            // every reservation, which is most of what a TRNC lawyer sees.
            projectUnit: {
              select: { unitNo: true, project: { select: { nameI18n: true } } },
            },
          },
        },
      },
    });
    return rows.map((r) => ({
      ...this.engagementShape(r, lawyerUserId),
      deal: {
        id: r.deal.id,
        kind: r.deal.kind,
        currentStageKey: r.deal.currentStageKey,
        status: r.deal.status,
        title: r.deal.property
          ? this.titleOf(r.deal.property.titleI18n)
          : r.deal.projectUnit
            ? `${this.titleOf(r.deal.projectUnit.project.nameI18n)} — ${r.deal.projectUnit.unitNo}`
            : 'this property',
      },
    }));
  }

  // ── responding ───────────────────────────────────────────────────

  async quote(lawyerUserId: string, engagementId: string, dto: QuoteDto, ip?: string) {
    const e = await this.assertLawyerOn(lawyerUserId, engagementId);
    if (!OPEN_STATUSES.includes(e.status as (typeof OPEN_STATUSES)[number])) {
      throw new BadRequestException(`Cannot quote on a ${e.status} request`);
    }

    const updated = await this.prisma.legalEngagement.update({
      where: { id: engagementId },
      data: {
        status: 'quoted',
        quoteAmount: dto.amount,
        quoteCurrency: dto.currency,
        quoteNote: dto.note ?? null,
        quotedAt: new Date(),
      },
    });

    await this.notifications.notify(e.requestedByUserId, 'legal.quote_received', {
      lawyer: await this.lawyerName(lawyerUserId),
      amount: dto.amount,
      currency: dto.currency,
      title: await this.dealTitle(e.dealId),
    });
    await this.audit.log({
      actorId: lawyerUserId,
      action: 'legal.quoted',
      entityType: 'legal_engagement',
      entityId: engagementId,
      after: { amount: dto.amount, currency: dto.currency },
      ip,
    });
    return this.engagementShape(updated, lawyerUserId);
  }

  async decline(lawyerUserId: string, engagementId: string, ip?: string) {
    const e = await this.assertLawyerOn(lawyerUserId, engagementId);
    if (!OPEN_STATUSES.includes(e.status as (typeof OPEN_STATUSES)[number])) {
      throw new BadRequestException(`Cannot decline a ${e.status} request`);
    }
    const updated = await this.prisma.legalEngagement.update({
      where: { id: engagementId },
      data: { status: 'declined', respondedAt: new Date() },
    });
    await this.notifications.notify(e.requestedByUserId, 'legal.quote_declined', {
      lawyer: await this.lawyerName(lawyerUserId),
      title: await this.dealTitle(e.dealId),
    });
    await this.audit.log({
      actorId: lawyerUserId,
      action: 'legal.declined',
      entityType: 'legal_engagement',
      entityId: engagementId,
      ip,
    });
    return this.engagementShape(updated, lawyerUserId);
  }

  /**
   * Accepting is the moment the lawyer becomes a party.
   *
   * Three things happen together, in one transaction, because a lawyer who
   * appears in the deal-room member list but cannot open the room — or the
   * reverse — is worse than one who is not there at all.
   */
  async accept(userId: string, engagementId: string, ip?: string) {
    const e = await this.prisma.legalEngagement.findUnique({ where: { id: engagementId } });
    if (!e) throw new NotFoundException('Engagement not found');
    if (e.requestedByUserId !== userId) throw new ForbiddenException('Not your request');
    if (e.status !== 'quoted') {
      throw new BadRequestException(
        e.status === 'requested'
          ? 'This lawyer has not quoted yet'
          : `Cannot accept a ${e.status} request`,
      );
    }

    const alreadyAccepted = await this.prisma.legalEngagement.findFirst({
      where: { dealId: e.dealId, requestedByUserId: userId, status: 'accepted' },
    });
    if (alreadyAccepted) throw new BadRequestException('You have already engaged a lawyer on this deal');

    const conversation = await this.prisma.conversation.findFirst({
      where: { dealId: e.dealId },
      select: { id: true },
    });

    // Captured BEFORE the transaction closes them. Reading them back afterwards
    // by status would also sweep up requests this party withdrew days ago and
    // tell those lawyers a second time.
    const toClose = await this.prisma.legalEngagement.findMany({
      where: {
        dealId: e.dealId,
        requestedByUserId: userId,
        id: { not: engagementId },
        status: { in: [...OPEN_STATUSES] },
      },
      select: { lawyerUserId: true },
    });

    const [updated] = await this.prisma.$transaction([
      this.prisma.legalEngagement.update({
        where: { id: engagementId },
        data: { status: 'accepted', respondedAt: new Date() },
      }),
      this.prisma.dealParty.create({
        data: { dealId: e.dealId, userId: e.lawyerUserId, partyRole: 'lawyer' },
      }),
      // The other requests this party had open are now dead. Closing them is
      // not tidiness: a lawyer who quoted and hears nothing has no way to know
      // the work went elsewhere.
      this.prisma.legalEngagement.updateMany({
        where: {
          dealId: e.dealId,
          requestedByUserId: userId,
          id: { not: engagementId },
          status: { in: [...OPEN_STATUSES] },
        },
        data: { status: 'withdrawn', respondedAt: new Date() },
      }),
      ...(conversation
        ? [
            // `roleInConvo` is a free-form side label; only 'owner_anonymous'
            // changes behaviour (§13.6 scrubbing), and a deal room never
            // scrubs anyway. 'lawyer' keeps them out of the lead counts, which
            // count 'customer' participants — a lawyer is not a lead.
            this.prisma.conversationParticipant.create({
              data: { conversationId: conversation.id, userId: e.lawyerUserId, roleInConvo: 'lawyer' },
            }),
          ]
        : []),
    ]);

    const title = await this.dealTitle(e.dealId);
    const lawyer = await this.lawyerName(e.lawyerUserId);

    await this.notifications.notify(e.lawyerUserId, 'legal.engagement_accepted', { title });

    // Everyone else in the room is told, because an unexplained stranger in a
    // deal about someone's house reads as a breach, not a service.
    const parties = await this.prisma.dealParty.findMany({
      where: { dealId: e.dealId },
      select: { userId: true },
    });
    const told = new Set<string>([e.lawyerUserId]);
    for (const p of parties) {
      if (told.has(p.userId)) continue;
      told.add(p.userId);
      await this.notifications.notify(p.userId, 'legal.lawyer_joined', { lawyer, title });
    }

    // The lawyers whose requests this acceptance closed.
    for (const c of toClose) {
      await this.notifications.notify(c.lawyerUserId, 'legal.request_withdrawn', { title });
    }

    await this.audit.log({
      actorId: userId,
      action: 'legal.engagement_accepted',
      entityType: 'legal_engagement',
      entityId: engagementId,
      after: { dealId: e.dealId, lawyerUserId: e.lawyerUserId },
      ip,
    });

    return this.engagementShape(updated, userId);
  }

  async withdraw(userId: string, engagementId: string, ip?: string) {
    const e = await this.prisma.legalEngagement.findUnique({ where: { id: engagementId } });
    if (!e) throw new NotFoundException('Engagement not found');
    if (e.requestedByUserId !== userId) throw new ForbiddenException('Not your request');
    if (!OPEN_STATUSES.includes(e.status as (typeof OPEN_STATUSES)[number])) {
      throw new BadRequestException(
        e.status === 'accepted'
          ? 'An accepted engagement cannot be withdrawn here — the lawyer is a party to this deal'
          : `Cannot withdraw a ${e.status} request`,
      );
    }
    const updated = await this.prisma.legalEngagement.update({
      where: { id: engagementId },
      data: { status: 'withdrawn', respondedAt: new Date() },
    });
    await this.notifications.notify(e.lawyerUserId, 'legal.request_withdrawn', {
      title: await this.dealTitle(e.dealId),
    });
    await this.audit.log({
      actorId: userId,
      action: 'legal.request_withdrawn',
      entityType: 'legal_engagement',
      entityId: engagementId,
      ip,
    });
    return this.engagementShape(updated, userId);
  }

  // ── helpers ──────────────────────────────────────────────────────

  private async assertParty(userId: string, dealId: string, opts: { allowLawyer?: boolean } = {}) {
    const party = await this.prisma.dealParty.findFirst({ where: { dealId, userId } });
    if (party) {
      // An engaged lawyer is a party, but they engage nobody: only a principal
      // or their agent brings another professional into a deal.
      if (!opts.allowLawyer && party.partyRole === 'lawyer') {
        throw new ForbiddenException('A lawyer cannot engage another lawyer on this deal');
      }
      return party;
    }
    if (opts.allowLawyer) {
      const pending = await this.prisma.legalEngagement.findFirst({
        where: { dealId, lawyerUserId: userId },
      });
      if (pending) return null;
    }
    throw new ForbiddenException('Not a party to this deal');
  }

  private async assertLawyerOn(lawyerUserId: string, engagementId: string) {
    const e = await this.prisma.legalEngagement.findUnique({ where: { id: engagementId } });
    if (!e) throw new NotFoundException('Engagement not found');
    if (e.lawyerUserId !== lawyerUserId) throw new ForbiddenException('Not your request');
    return e;
  }

  /**
   * Quote figures are visible to the two people the quote is between, and to
   * nobody else — including the other side of the same deal.
   */
  private engagementShape(
    e: {
      id: string;
      dealId: string;
      lawyerUserId: string;
      requestedByUserId: string;
      stageKey: string;
      status: string;
      scope: string | null;
      quoteAmount: unknown;
      quoteCurrency: string | null;
      quoteNote: string | null;
      quotedAt: Date | null;
      respondedAt: Date | null;
      createdAt: Date;
      lawyer?: { id: string; lawyerProfile: { firmName: string | null } | null };
    },
    viewerId: string,
  ) {
    const involved = viewerId === e.lawyerUserId || viewerId === e.requestedByUserId;
    return {
      id: e.id,
      dealId: e.dealId,
      lawyerUserId: e.lawyerUserId,
      lawyerName: e.lawyer?.lawyerProfile?.firmName?.trim() || 'Lawyer',
      requestedByUserId: e.requestedByUserId,
      stageKey: e.stageKey,
      status: e.status,
      scope: e.scope,
      quoteAmount: involved && e.quoteAmount != null ? Number(e.quoteAmount) : null,
      quoteCurrency: involved ? e.quoteCurrency : null,
      quoteNote: involved ? e.quoteNote : null,
      quotedAt: e.quotedAt,
      respondedAt: e.respondedAt,
      createdAt: e.createdAt,
    };
  }

  private titleOf(titleI18n: unknown): string {
    const t = (titleI18n ?? {}) as Record<string, string>;
    return t.en || Object.values(t)[0] || 'this property';
  }

  /** The name a notification calls the deal. Off-plan deals name the project. */
  private async dealTitle(dealId: string): Promise<string> {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: {
        property: { select: { titleI18n: true } },
        projectUnit: {
          select: { unitNo: true, project: { select: { nameI18n: true } } },
        },
      },
    });
    if (deal?.property) return this.titleOf(deal.property.titleI18n);
    if (deal?.projectUnit) {
      return `${this.titleOf(deal.projectUnit.project.nameI18n)} — ${deal.projectUnit.unitNo}`;
    }
    return 'this property';
  }

  private async lawyerName(userId: string): Promise<string> {
    const p = await this.prisma.lawyerProfile.findUnique({
      where: { userId },
      select: { firmName: true },
    });
    return p?.firmName?.trim() || 'Your lawyer';
  }
}
