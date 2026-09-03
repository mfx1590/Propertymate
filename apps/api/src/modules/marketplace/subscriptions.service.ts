import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { PaymentsService } from '../payments/payments.service';
import type { RecordPaymentDto } from '../payments/dto/payments.dto';

/**
 * Still admin-granted (§13.3 decision, 2026-07-12) — there is no checkout,
 * because there is no payment provider. What changed in Phase 3 is that every
 * grant now writes a money record, so a comped account and a paying one are
 * finally distinguishable.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  /**
   * An agency member lists under the agency's subscription rather than buying
   * one of their own (§13.1 + §13.3): the agency is the paying entity, members
   * are staff. Checked here rather than at each gate so listings, projects and
   * anything added later inherit it.
   */
  async hasActive(userId: string): Promise<boolean> {
    if (await this.activeFor(userId)) return true;

    const membership = await this.prisma.agencyAgent.findFirst({
      where: { agentUserId: userId, status: 'active' },
      select: { agencyId: true },
    });
    return membership ? this.activeFor(membership.agencyId) : false;
  }

  private async activeFor(userId: string): Promise<boolean> {
    const count = await this.prisma.subscription.count({
      where: {
        userId,
        status: 'active',
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
    });
    return count > 0;
  }

  async mySubscriptions(userId: string) {
    return this.prisma.subscription.findMany({
      where: { userId },
      include: { plan: { select: { key: true, name: true, tier: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async grant(
    adminId: string,
    identifier: string,
    planKey: string,
    months?: number,
    ip?: string,
    payment?: RecordPaymentDto,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }] },
    });
    if (!user) throw new NotFoundException(`No user with email/phone ${identifier}`);
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan || !plan.active) throw new BadRequestException(`Unknown or inactive plan ${planKey}`);

    const endsAt = months ? new Date(Date.now() + months * 30 * 86_400_000) : null;
    const sub = await this.prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        grantedByAdminId: adminId,
        endsAt,
      },
    });
    await this.audit.log({
      actorId: adminId,
      action: 'subscription.grant',
      entityType: 'subscription',
      entityId: sub.id,
      after: { userId: user.id, planKey, months },
      ip,
    });

    // Every grant gets a ledger row, including the free ones — a waived grant
    // is a fact worth recording, and it is the half the audit log never held.
    // The plan's price is frozen into the row here: repricing the plan next
    // month must not rewrite what this period was worth.
    const entry = await this.payments.recordForSubscription({
      adminId,
      userId: user.id,
      subscriptionId: sub.id,
      planKey: plan.key,
      listAmount: plan.priceAmount ? Number(plan.priceAmount) : 0,
      // An unpriced plan still needs a currency on the row for the totals to
      // group; GBP is the platform's base everywhere else (§6.1).
      currency: plan.currency ?? 'GBP',
      periodStart: sub.startsAt,
      periodEnd: endsAt,
      payment,
      ip,
    });

    return { ...sub, payment: entry };
  }

  async revoke(adminId: string, subscriptionId: string, ip?: string) {
    const sub = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'cancelled', endsAt: new Date() },
    });
    await this.audit.log({
      actorId: adminId,
      action: 'subscription.revoke',
      entityType: 'subscription',
      entityId: sub.id,
      ip,
    });
    return sub;
  }

  async adminList() {
    return this.prisma.subscription.findMany({
      include: { plan: { select: { key: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Public plan list. Prices are included and are `null` until an admin sets
   * one — `priced: false` says so outright, rather than leaving a client to
   * infer "free" from a missing number.
   */
  async listPlans() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ roleKey: 'asc' }, { tier: 'asc' }],
    });
    return plans.map((p) => ({
      key: p.key,
      name: p.name,
      roleKey: p.roleKey,
      tier: p.tier,
      priceAmount: p.priceAmount === null ? null : Number(p.priceAmount),
      currency: p.currency,
      interval: p.interval,
      priced: p.priceAmount !== null,
    }));
  }
}
