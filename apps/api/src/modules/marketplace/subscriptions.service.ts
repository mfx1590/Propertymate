import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

/** Admin-granted until Phase 3 payments (§13.3 decision). */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async hasActive(userId: string): Promise<boolean> {
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

  async grant(adminId: string, identifier: string, planKey: string, months?: number, ip?: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }] },
    });
    if (!user) throw new NotFoundException(`No user with email/phone ${identifier}`);
    const plan = await this.prisma.plan.findUnique({ where: { key: planKey } });
    if (!plan || !plan.active) throw new BadRequestException(`Unknown or inactive plan ${planKey}`);

    const sub = await this.prisma.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        grantedByAdminId: adminId,
        endsAt: months ? new Date(Date.now() + months * 30 * 86_400_000) : null,
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
    return sub;
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

  listPlans() {
    return this.prisma.plan.findMany({ where: { active: true }, orderBy: [{ roleKey: 'asc' }, { tier: 'asc' }] });
  }
}
