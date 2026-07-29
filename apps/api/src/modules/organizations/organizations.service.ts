import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AddMemberDto, UpdateMemberDto } from './dto/organizations.dto';

/** Closed-deal counts drive the public per-member stats (§13.2). */
interface MemberStats {
  salesClosed: number;
  rentalsClosed: number;
}

/**
 * Agency organizations (Plan §13.1). The agency account is implicitly the org
 * admin; it may promote members to `org_admin` so they can manage the team too.
 *
 * Members are ordinary users carrying the `agency_member` role. They inherit
 * the agency's verification rather than uploading documents of their own — the
 * agency is the legal entity the platform verified (§13.1 government legality).
 */
@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolves which agency the caller may administer.
   *
   * `agency.agents.manage` is deliberately coarse on the `agency_member` role
   * (the guard admits any member); this is the precise check, mirroring how
   * `listing.update.own` is granted broadly and ownership enforced in-service.
   */
  private async assertOrgAdmin(userId: string): Promise<string> {
    const own = await this.prisma.agencyProfile.findUnique({ where: { userId } });
    if (own) return own.userId;

    const membership = await this.prisma.agencyAgent.findFirst({
      where: { agentUserId: userId, orgRole: 'org_admin', status: 'active' },
    });
    if (!membership) throw new ForbiddenException('Not an agency administrator');
    return membership.agencyId;
  }

  /** Closed sales/rentals per user, counted once per deal they were a party to. */
  private async statsFor(userIds: string[]): Promise<Record<string, MemberStats>> {
    const empty = (): MemberStats => ({ salesClosed: 0, rentalsClosed: 0 });
    const stats: Record<string, MemberStats> = Object.fromEntries(
      userIds.map((id) => [id, empty()]),
    );
    if (userIds.length === 0) return stats;

    const parties = await this.prisma.dealParty.findMany({
      where: {
        userId: { in: userIds },
        partyRole: { in: ['agent_buyer_side', 'agent_seller_side'] },
        deal: { status: 'completed' },
      },
      select: { userId: true, dealId: true, deal: { select: { kind: true } } },
    });

    // a member can hold two party rows on one deal; count the deal once
    const seen = new Set<string>();
    for (const p of parties) {
      const key = `${p.userId}:${p.dealId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.deal.kind === 'rental') stats[p.userId].rentalsClosed++;
      else stats[p.userId].salesClosed++;
    }
    return stats;
  }

  async listMembers(userId: string) {
    const agencyId = await this.assertOrgAdmin(userId);
    return this.membersOf(agencyId, { includeDeactivated: true });
  }

  private async membersOf(agencyId: string, opts: { includeDeactivated: boolean }) {
    const rows = await this.prisma.agencyAgent.findMany({
      where: { agencyId, ...(opts.includeDeactivated ? {} : { status: 'active' }) },
      include: {
        agent: {
          select: {
            id: true,
            phone: true,
            email: true,
            avatarUrl: true,
            agentProfile: { select: { bio: true, regions: true, ratingAvg: true, dealCount: true } },
          },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    const stats = await this.statsFor(rows.map((r) => r.agent.id));
    return rows.map((r) => ({
      userId: r.agent.id,
      phone: r.agent.phone,
      email: r.agent.email,
      avatarUrl: r.agent.avatarUrl,
      bio: r.agent.agentProfile?.bio ?? null,
      regions: r.agent.agentProfile?.regions ?? [],
      ratingAvg: r.agent.agentProfile?.ratingAvg ?? null,
      orgRole: r.orgRole,
      status: r.status,
      joinedAt: r.joinedAt,
      ...stats[r.agent.id],
    }));
  }

  /**
   * Adds a member by phone. An unknown phone gets an account created for it —
   * the person signs in with the usual OTP flow, so no credential ever changes
   * hands. An existing user is linked, provided they are not already in an org.
   */
  async addMember(userId: string, dto: AddMemberDto, ip?: string) {
    const agencyId = await this.assertOrgAdmin(userId);

    const agencyRole = await this.prisma.userRole.findFirst({
      where: { userId: agencyId, role: { key: 'agency' } },
      select: { verificationStatus: true },
    });

    const [memberRole, customerRole] = await Promise.all([
      this.prisma.role.findUnique({ where: { key: 'agency_member' } }),
      this.prisma.role.findUnique({ where: { key: 'customer' } }),
    ]);
    if (!memberRole || !customerRole) {
      throw new BadRequestException('Roles not seeded — run npm run db:seed');
    }

    let user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });

    if (user) {
      if (user.id === agencyId) throw new BadRequestException('That is the agency account itself');
      const existing = await this.prisma.agencyAgent.findFirst({
        where: { agentUserId: user.id, status: 'active' },
      });
      if (existing) {
        throw new BadRequestException(
          existing.agencyId === agencyId
            ? 'Already a member of this agency'
            : 'That user already belongs to another agency',
        );
      }
    } else {
      user = await this.prisma.user.create({ data: { phone: dto.phone } });
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: customerRole.id,
          verificationStatus: 'verified',
          badgeTier: 'verified',
        },
      });
    }

    // members inherit the agency's standing rather than verifying separately
    const inherited = agencyRole?.verificationStatus === 'verified' ? 'verified' : 'pending';
    const already = await this.prisma.userRole.findFirst({
      where: { userId: user.id, roleId: memberRole.id },
    });
    if (already) {
      await this.prisma.userRole.update({
        where: { id: already.id },
        data: { verificationStatus: inherited },
      });
    } else {
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: memberRole.id,
          verificationStatus: inherited,
          badgeTier: inherited === 'verified' ? 'verified' : 'pending',
        },
      });
    }

    await this.prisma.agentProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, bio: dto.bio ?? null, regions: dto.regions ?? [] },
    });

    const membership = await this.prisma.agencyAgent.upsert({
      where: { agencyId_agentUserId: { agencyId, agentUserId: user.id } },
      update: { status: 'active', orgRole: dto.orgRole ?? 'member' },
      create: { agencyId, agentUserId: user.id, orgRole: dto.orgRole ?? 'member' },
    });

    await this.audit.log({
      actorId: userId,
      action: 'agency.member.add',
      entityType: 'agency_agent',
      entityId: user.id,
      after: { agencyId, orgRole: membership.orgRole, verificationStatus: inherited },
      ip,
    });

    return { userId: user.id, phone: user.phone, orgRole: membership.orgRole, status: 'active' };
  }

  async updateMember(userId: string, memberUserId: string, dto: UpdateMemberDto, ip?: string) {
    const agencyId = await this.assertOrgAdmin(userId);
    const membership = await this.prisma.agencyAgent.findUnique({
      where: { agencyId_agentUserId: { agencyId, agentUserId: memberUserId } },
    });
    if (!membership) throw new NotFoundException('Member not found');

    const updated = await this.prisma.agencyAgent.update({
      where: { agencyId_agentUserId: { agencyId, agentUserId: memberUserId } },
      data: {
        ...(dto.orgRole ? { orgRole: dto.orgRole } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    });

    await this.audit.log({
      actorId: userId,
      action: 'agency.member.update',
      entityType: 'agency_agent',
      entityId: memberUserId,
      before: { orgRole: membership.orgRole, status: membership.status },
      after: { orgRole: updated.orgRole, status: updated.status },
      ip,
    });
    return { userId: memberUserId, orgRole: updated.orgRole, status: updated.status };
  }

  /**
   * Soft-deactivates: the membership row survives so completed deals keep their
   * party history, but the `agency_member` role assignment is deleted outright.
   * That deletion is what actually revokes access — PermissionsGuard resolves
   * permissions from role assignments alone and never looks at
   * `verificationStatus`, so merely downgrading the status would leave a
   * removed member holding every listing permission.
   */
  async removeMember(userId: string, memberUserId: string, ip?: string) {
    const agencyId = await this.assertOrgAdmin(userId);
    const membership = await this.prisma.agencyAgent.findUnique({
      where: { agencyId_agentUserId: { agencyId, agentUserId: memberUserId } },
    });
    if (!membership) throw new NotFoundException('Member not found');

    await this.prisma.agencyAgent.update({
      where: { agencyId_agentUserId: { agencyId, agentUserId: memberUserId } },
      data: { status: 'deactivated', orgRole: 'member' },
    });
    await this.prisma.userRole.deleteMany({
      where: { userId: memberUserId, role: { key: 'agency_member' } },
    });

    await this.audit.log({
      actorId: userId,
      action: 'agency.member.deactivate',
      entityType: 'agency_agent',
      entityId: memberUserId,
      before: { status: membership.status },
      after: { status: 'deactivated' },
      ip,
    });
    return { userId: memberUserId, status: 'deactivated' };
  }

  /** Public agency page: verified tick, org totals, per-member stats (§13.2). */
  async publicAgency(agencyUserId: string) {
    const profile = await this.prisma.agencyProfile.findUnique({
      where: { userId: agencyUserId },
      include: {
        user: {
          select: {
            id: true,
            avatarUrl: true,
            userRoles: {
              where: { role: { key: 'agency' } },
              select: { verificationStatus: true, badgeTier: true },
            },
          },
        },
      },
    });
    if (!profile) throw new NotFoundException('Agency not found');

    const role = profile.user.userRoles[0];
    if (role?.verificationStatus !== 'verified') throw new NotFoundException('Agency not found');

    const members = await this.membersOf(agencyUserId, { includeDeactivated: false });
    const agencyOwn = (await this.statsFor([agencyUserId]))[agencyUserId];

    return {
      userId: profile.userId,
      companyName: profile.companyName,
      about: profile.about,
      address: profile.address,
      logoUrl: profile.logoUrl,
      avatarUrl: profile.user.avatarUrl,
      badgeTier: role.badgeTier,
      verified: true,
      // contact details are never published — the platform mediates (§13.4)
      members: members.map((m) => ({
        userId: m.userId,
        avatarUrl: m.avatarUrl,
        bio: m.bio,
        regions: m.regions,
        ratingAvg: m.ratingAvg,
        salesClosed: m.salesClosed,
        rentalsClosed: m.rentalsClosed,
        joinedAt: m.joinedAt,
      })),
      totals: {
        members: members.length,
        salesClosed: agencyOwn.salesClosed + members.reduce((n, m) => n + m.salesClosed, 0),
        rentalsClosed: agencyOwn.rentalsClosed + members.reduce((n, m) => n + m.rentalsClosed, 0),
      },
    };
  }
}
