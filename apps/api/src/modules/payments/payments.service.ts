import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PROVIDERS, manualProvider } from './payment-provider';
import { RecordPaymentDto, SetPlanPriceDto } from './dto/payments.dto';

/** A page of ledger rows; the admin screen never needs more at once. */
const PAGE_SIZE = 50;

/**
 * The money record (Plan §9, Phase 3 payments — the subscription half).
 *
 * Two things live here and nothing else does yet: what a plan costs, and an
 * append-only record of every payment event. There is no card processing, no
 * escrow, and no success-fee billing — those are separately gated (a provider
 * that will onboard a TRNC entity, a written legal opinion, and tax treatment
 * respectively) and none of them is answered.
 *
 * **Nothing here gates access.** `SubscriptionsService.hasActive` still asks
 * only whether a subscription is live, so an unpriced plan and an unpaid one
 * both keep working exactly as before. Making payment a condition of listing
 * is a business decision with a live customer base behind it, not a side
 * effect of adding a price column.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── plan pricing ─────────────────────────────────────────────────

  /**
   * Set (or clear) what a plan costs.
   *
   * Clearing is a real operation, not an oversight: a plan whose price is being
   * reconsidered should say "not priced" rather than keep quoting a number
   * nobody stands behind.
   */
  async setPlanPrice(adminId: string, planKey: string, dto: SetPlanPriceDto, ip?: string) {
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan) throw new NotFoundException(`Unknown plan ${planKey}`);

    const clearing = dto.priceAmount === null || dto.priceAmount === undefined;
    if (!clearing && !dto.currency) {
      throw new BadRequestException('A price needs a currency');
    }
    if (!clearing && !dto.interval) {
      throw new BadRequestException('A price needs a billing interval');
    }

    const before = {
      priceAmount: plan.priceAmount ? Number(plan.priceAmount) : null,
      currency: plan.currency,
      interval: plan.interval,
    };
    const updated = await this.prisma.plan.update({
      where: { key: planKey },
      data: clearing
        ? { priceAmount: null, currency: null, interval: null }
        : {
            priceAmount: new Prisma.Decimal(dto.priceAmount as number),
            currency: dto.currency,
            interval: dto.interval,
          },
    });

    await this.audit.log({
      actorId: adminId,
      action: 'plan.price_set',
      entityType: 'plan',
      entityId: plan.id,
      before,
      after: {
        priceAmount: updated.priceAmount ? Number(updated.priceAmount) : null,
        currency: updated.currency,
        interval: updated.interval,
      },
      ip,
    });
    return this.planShape(updated);
  }

  private planShape(p: {
    key: string;
    name: string;
    roleKey: string;
    tier: number;
    active: boolean;
    priceAmount: Prisma.Decimal | null;
    currency: string | null;
    interval: string | null;
  }) {
    return {
      key: p.key,
      name: p.name,
      roleKey: p.roleKey,
      tier: p.tier,
      active: p.active,
      priceAmount: p.priceAmount === null ? null : Number(p.priceAmount),
      currency: p.currency,
      interval: p.interval,
      /** Said explicitly so a client never has to infer it from three nulls. */
      priced: p.priceAmount !== null,
    };
  }

  // ── the ledger ───────────────────────────────────────────────────

  /**
   * Write the payment record for a subscription period.
   *
   * Called by `SubscriptionsService.grant` for every grant, including the free
   * ones — a grant with no money attached is a `waived` row, which is what
   * makes "who are we giving this to" answerable. Before this, a comped account
   * and a paying one were indistinguishable in the data.
   */
  async recordForSubscription(input: {
    adminId: string;
    userId: string;
    subscriptionId: string;
    planKey: string;
    listAmount: number;
    currency: string;
    periodStart: Date;
    periodEnd: Date | null;
    payment?: RecordPaymentDto;
    ip?: string;
  }) {
    const p = input.payment;
    const amount = p?.amount ?? 0;
    if (amount < 0) throw new BadRequestException('A payment cannot be negative — reverse it instead');

    const occurredAt = p?.occurredAt ? new Date(p.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime())) throw new BadRequestException('occurredAt is not a date');
    if (occurredAt.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException('A payment cannot have occurred tomorrow');
    }

    const result = await manualProvider.collect({
      userId: input.userId,
      planKey: input.planKey,
      listAmount: input.listAmount,
      currency: input.currency,
      amount,
      reference: p?.reference,
      note: p?.note,
      occurredAt,
    });

    const entry = await this.prisma.paymentLedgerEntry.create({
      data: {
        userId: input.userId,
        subscriptionId: input.subscriptionId,
        planKey: input.planKey,
        listAmount: new Prisma.Decimal(input.listAmount),
        amount: new Prisma.Decimal(amount),
        currency: input.currency,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        provider: result.provider,
        providerRef: result.providerRef,
        status: result.collected ? 'recorded' : 'waived',
        note: p?.note ?? null,
        occurredAt,
        recordedByAdminId: input.adminId,
      },
    });

    await this.audit.log({
      actorId: input.adminId,
      action: 'payment.recorded',
      entityType: 'payment_ledger_entry',
      entityId: entry.id,
      after: { userId: input.userId, planKey: input.planKey, amount, currency: input.currency, status: entry.status },
      ip: input.ip,
    });
    return this.entryShape(entry);
  }

  /**
   * Cancel an earlier entry by adding its opposite.
   *
   * The original row is never touched. That is the whole discipline of this
   * table: a payment that was recorded wrongly stays visible, with the
   * correction beside it, because a disputed charge has to be reconstructable
   * afterwards and an overwritten row cannot be.
   */
  async reverse(adminId: string, entryId: string, note?: string, ip?: string) {
    const original = await this.prisma.paymentLedgerEntry.findUnique({ where: { id: entryId } });
    if (!original) throw new NotFoundException('Ledger entry not found');
    if (original.status === 'reversal') {
      throw new BadRequestException('A reversal cannot itself be reversed');
    }
    const already = await this.prisma.paymentLedgerEntry.findUnique({
      where: { reversesEntryId: entryId },
    });
    if (already) throw new BadRequestException('This entry has already been reversed');

    const entry = await this.prisma.paymentLedgerEntry.create({
      data: {
        userId: original.userId,
        subscriptionId: original.subscriptionId,
        planKey: original.planKey,
        // Both figures negate, so summing either column over the whole ledger
        // still gives the truth after a correction.
        listAmount: original.listAmount.neg(),
        amount: original.amount.neg(),
        currency: original.currency,
        periodStart: original.periodStart,
        periodEnd: original.periodEnd,
        provider: original.provider,
        providerRef: original.providerRef,
        status: 'reversal',
        note: note ?? null,
        occurredAt: new Date(),
        recordedByAdminId: adminId,
        reversesEntryId: original.id,
      },
    });

    await this.audit.log({
      actorId: adminId,
      action: 'payment.reversed',
      entityType: 'payment_ledger_entry',
      entityId: entry.id,
      before: { originalId: original.id, amount: Number(original.amount) },
      after: { amount: Number(entry.amount) },
      ip,
    });
    return this.entryShape(entry);
  }

  /** The admin ledger, newest first, with the totals that read off it. */
  async adminLedger(cursor?: string) {
    const rows = await this.prisma.paymentLedgerEntry.findMany({
      take: PAGE_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, email: true, phone: true } } },
    });

    return {
      entries: rows.map((r) => ({ ...this.entryShape(r), user: r.user })),
      nextCursor: rows.length === PAGE_SIZE ? rows[rows.length - 1].id : null,
      totals: await this.totals(),
    };
  }

  /**
   * Collected and foregone, per currency.
   *
   * Two separate numbers because they answer different questions: what came in,
   * and what was given away. A single "revenue" figure that quietly folded
   * comped accounts in would flatter the business.
   */
  async totals() {
    const grouped = await this.prisma.paymentLedgerEntry.groupBy({
      by: ['currency'],
      _sum: { amount: true, listAmount: true },
    });
    return grouped
      .map((g) => {
        const collected = Number(g._sum.amount ?? 0);
        const list = Number(g._sum.listAmount ?? 0);
        return {
          currency: g.currency,
          collected,
          listed: list,
          foregone: Math.max(0, list - collected),
        };
      })
      .sort((a, b) => b.collected - a.collected);
  }

  /** A user's own payment history. */
  async mine(userId: string) {
    const rows = await this.prisma.paymentLedgerEntry.findMany({
      where: { userId },
      orderBy: { occurredAt: 'desc' },
      take: PAGE_SIZE,
    });
    return rows.map((r) => this.entryShape(r));
  }

  private entryShape(e: {
    id: string;
    userId: string;
    kind: string;
    subscriptionId: string | null;
    planKey: string;
    listAmount: Prisma.Decimal;
    amount: Prisma.Decimal;
    currency: string;
    periodStart: Date;
    periodEnd: Date | null;
    provider: string;
    providerRef: string | null;
    status: string;
    note: string | null;
    occurredAt: Date;
    reversesEntryId: string | null;
    createdAt: Date;
  }) {
    return {
      id: e.id,
      userId: e.userId,
      kind: e.kind,
      subscriptionId: e.subscriptionId,
      planKey: e.planKey,
      listAmount: Number(e.listAmount),
      amount: Number(e.amount),
      currency: e.currency,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      provider: e.provider,
      providerRef: e.providerRef,
      status: e.status,
      note: e.note,
      occurredAt: e.occurredAt,
      reversesEntryId: e.reversesEntryId,
      createdAt: e.createdAt,
    };
  }

  /** Which providers this deployment can actually use. One, today. */
  providers() {
    return Object.keys(PROVIDERS);
  }
}
