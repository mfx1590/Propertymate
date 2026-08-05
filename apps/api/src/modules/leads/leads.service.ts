import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';

/**
 * Where a prospect has got to. Ordered — a lead only ever moves forward, and
 * the UI sorts on it, so the order here is the order in the funnel.
 */
export const LEAD_STAGES = [
  'new',
  'in_conversation',
  'viewing_booked',
  'viewing_done',
  'offer_made',
  'won',
  'lost',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

interface LeadAccumulator {
  propertyId: string;
  customerId: string;
  conversationId: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  lastMessage: { body: string; at: Date; fromCustomer: boolean } | null;
  unread: number;
  firstCustomerMessageAt: Date | null;
  firstResponseAt: Date | null;
  viewings: { id: string; scheduledAt: Date; status: string }[];
  offers: { id: string; amount: number; currency: string; status: string; createdAt: Date }[];
  dealId: string | null;
  dealStatus: string | null;
}

/**
 * Lead inbox (Plan §6.2): "inquiries, viewings, offers per listing, with
 * response-time tracking".
 *
 * A lead is one prospect on one listing, not one conversation: the same person
 * can message, book a viewing and then offer, and a lister needs that as a
 * single row they can act on.
 *
 * Scoping is what keeps §13.4 intact. Leads are derived from the listings the
 * caller actually fronts — for a mediated resale that is the publishing agent,
 * never the owner — and the owner↔agent channel is excluded because it has no
 * `customer` participant. An owner therefore sees no prospect identities on a
 * mediated listing, which is the anonymity contract, not an omission.
 */
@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
  ) {}

  /** Listings the caller fronts: created by them, or published by them (§13.4). */
  private async myPropertyIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.property.findMany({
      where: {
        deletedAt: null,
        OR: [{ createdByUserId: userId }, { publishedByAgentId: userId }],
      },
      select: { id: true, publishedByAgentId: true, createdByUserId: true },
    });
    // On a mediated listing the agent fronts the customer; the owner's own view
    // of that property carries no prospect identity at all.
    return rows
      .filter((p) => !p.publishedByAgentId || p.publishedByAgentId === userId)
      .map((p) => p.id);
  }

  async inbox(userId: string, filters: { propertyId?: string; stage?: string } = {}) {
    let propertyIds = await this.myPropertyIds(userId);
    if (filters.propertyId) {
      propertyIds = propertyIds.filter((id) => id === filters.propertyId);
    }
    if (propertyIds.length === 0) {
      return { summary: this.summarise([]), listings: [], leads: [] };
    }

    const leads = new Map<string, LeadAccumulator>();
    const key = (propertyId: string, customerId: string) => `${propertyId}:${customerId}`;
    const touch = (propertyId: string, customerId: string, at: Date): LeadAccumulator => {
      const k = key(propertyId, customerId);
      let lead = leads.get(k);
      if (!lead) {
        lead = {
          propertyId, customerId,
          conversationId: null,
          createdAt: at,
          lastActivityAt: at,
          lastMessage: null,
          unread: 0,
          firstCustomerMessageAt: null,
          firstResponseAt: null,
          viewings: [],
          offers: [],
          dealId: null,
          dealStatus: null,
        };
        leads.set(k, lead);
      }
      if (at < lead.createdAt) lead.createdAt = at;
      if (at > lead.lastActivityAt) lead.lastActivityAt = at;
      return lead;
    };

    const [conversations, viewings, offers, deals, properties] = await Promise.all([
      this.prisma.conversation.findMany({
        where: {
          propertyId: { in: propertyIds },
          dealId: null,
          participants: { some: { userId } },
        },
        include: {
          participants: { select: { userId: true, roleInConvo: true } },
          messages: { orderBy: { createdAt: 'asc' }, select: { senderId: true, body: true, createdAt: true, readAt: true } },
        },
      }),
      this.prisma.viewing.findMany({
        where: { propertyId: { in: propertyIds }, hostUserId: userId },
        select: { id: true, propertyId: true, customerId: true, scheduledAt: true, status: true, createdAt: true },
      }),
      this.prisma.offer.findMany({
        where: { propertyId: { in: propertyIds } },
        select: { id: true, propertyId: true, customerId: true, amount: true, currency: true, status: true, createdAt: true },
      }),
      this.prisma.deal.findMany({
        where: { propertyId: { in: propertyIds } },
        select: {
          id: true, propertyId: true, status: true, createdAt: true,
          parties: { where: { partyRole: 'buyer' }, select: { userId: true } },
        },
      }),
      this.prisma.property.findMany({
        where: { id: { in: propertyIds } },
        select: { id: true, titleI18n: true, status: true, kind: true },
      }),
    ]);

    for (const convo of conversations) {
      const customer = convo.participants.find((p) => p.roleInConvo === 'customer');
      if (!customer || !convo.propertyId) continue; // owner↔agent channel: not a lead
      const lead = touch(convo.propertyId, customer.userId, convo.createdAt);
      lead.conversationId = convo.id;

      for (const m of convo.messages) {
        const fromCustomer = m.senderId === customer.userId;
        if (fromCustomer && !lead.firstCustomerMessageAt) lead.firstCustomerMessageAt = m.createdAt;
        if (!fromCustomer && lead.firstCustomerMessageAt && !lead.firstResponseAt) {
          lead.firstResponseAt = m.createdAt;
        }
        if (fromCustomer && !m.readAt) lead.unread++;
        if (m.createdAt > lead.lastActivityAt) lead.lastActivityAt = m.createdAt;
        lead.lastMessage = { body: m.body, at: m.createdAt, fromCustomer };
      }
    }

    for (const v of viewings) {
      const lead = touch(v.propertyId, v.customerId, v.createdAt);
      lead.viewings.push({ id: v.id, scheduledAt: v.scheduledAt, status: v.status });
    }
    for (const o of offers) {
      const lead = touch(o.propertyId, o.customerId, o.createdAt);
      lead.offers.push({
        id: o.id,
        amount: Number(o.amount),
        currency: o.currency,
        status: o.status,
        createdAt: o.createdAt,
      });
    }
    for (const d of deals) {
      const buyer = d.parties[0]?.userId;
      if (!buyer || !d.propertyId) continue;
      const lead = touch(d.propertyId, buyer, d.createdAt);
      lead.dealId = d.id;
      lead.dealStatus = d.status;
    }

    const titles = new Map(
      properties.map((p) => [p.id, { title: (p.titleI18n as { en?: string })?.en ?? '', status: p.status, kind: p.kind }]),
    );

    const shaped = await Promise.all(
      [...leads.values()].map(async (lead) => {
        const revealed = await this.chat.contactRevealed(lead.propertyId, [userId, lead.customerId]);
        // §2.4: identity is withheld until the reveal gate is passed. The lister
        // can still work the lead — the thread, viewing and offer all function
        // without knowing who they are talking to.
        const customer = revealed
          ? await this.prisma.user.findUnique({
              where: { id: lead.customerId },
              select: { id: true, phone: true, email: true, avatarUrl: true },
            })
          : null;

        const firstResponseSec =
          lead.firstCustomerMessageAt && lead.firstResponseAt
            ? Math.round((lead.firstResponseAt.getTime() - lead.firstCustomerMessageAt.getTime()) / 1000)
            : null;

        return {
          propertyId: lead.propertyId,
          property: titles.get(lead.propertyId) ?? { title: '', status: 'unknown', kind: 'resale' },
          conversationId: lead.conversationId,
          stage: this.stageOf(lead),
          contactRevealed: revealed,
          customer: customer
            ? { id: customer.id, phone: customer.phone, email: customer.email, avatarUrl: customer.avatarUrl }
            : null,
          unread: lead.unread,
          lastMessage: lead.lastMessage,
          firstResponseSec,
          /** open and never answered — the number a lister should act on today */
          awaitingReply: lead.unread > 0 && lead.firstResponseAt === null,
          viewings: lead.viewings.sort((a, b) => +a.scheduledAt - +b.scheduledAt),
          offers: lead.offers.sort((a, b) => +b.createdAt - +a.createdAt),
          dealId: lead.dealId,
          createdAt: lead.createdAt,
          lastActivityAt: lead.lastActivityAt,
        };
      }),
    );

    const filtered = filters.stage ? shaped.filter((l) => l.stage === filters.stage) : shaped;
    filtered.sort((a, b) => +b.lastActivityAt - +a.lastActivityAt);

    return {
      summary: this.summarise(shaped),
      listings: properties
        .map((p) => ({
          propertyId: p.id,
          title: (p.titleI18n as { en?: string })?.en ?? '',
          status: p.status,
          leads: shaped.filter((l) => l.propertyId === p.id).length,
        }))
        .filter((l) => l.leads > 0)
        .sort((a, b) => b.leads - a.leads),
      leads: filtered,
    };
  }

  private stageOf(lead: LeadAccumulator): LeadStage {
    if (lead.dealStatus === 'completed') return 'won';
    if (lead.offers.some((o) => o.status === 'accepted') || lead.dealId) return 'won';
    if (lead.dealStatus === 'cancelled') return 'lost';
    if (lead.offers.some((o) => ['submitted', 'countered'].includes(o.status))) return 'offer_made';
    // a rejected/withdrawn offer with nothing live behind it is a dead lead
    if (lead.offers.length > 0) return 'lost';
    if (lead.viewings.some((v) => v.status === 'completed')) return 'viewing_done';
    if (lead.viewings.some((v) => ['requested', 'confirmed'].includes(v.status))) return 'viewing_booked';
    if (lead.viewings.length > 0) return 'lost'; // cancelled / no-show only
    return lead.lastMessage ? 'in_conversation' : 'new';
  }

  private summarise(leads: { stage: LeadStage; awaitingReply: boolean; firstResponseSec: number | null }[]) {
    const answered = leads.map((l) => l.firstResponseSec).filter((s): s is number => s !== null);
    const byStage = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
    for (const l of leads) byStage[l.stage]++;
    return {
      total: leads.length,
      awaitingReply: leads.filter((l) => l.awaitingReply).length,
      avgFirstResponseSec: answered.length
        ? Math.round(answered.reduce((a, b) => a + b, 0) / answered.length)
        : null,
      byStage,
    };
  }
}
