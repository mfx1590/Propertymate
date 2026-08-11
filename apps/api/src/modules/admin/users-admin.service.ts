import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

const STATUSES: UserStatus[] = ['active', 'suspended', 'banned'];

/**
 * Admin user management (Plan §6.7): suspend/ban with a reason, and grant or
 * revoke roles.
 *
 * Role grants live here because account type is chosen once at registration
 * (change log 2026-07-10) — everything after that is an admin action, and this
 * is the first place that has actually been possible.
 */
@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: { q?: string; status?: string; role?: string; limit?: number }) {
    const q = query.q?.trim();
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(query.status && STATUSES.includes(query.status as UserStatus)
          ? { status: query.status as UserStatus }
          : {}),
        ...(query.role ? { userRoles: { some: { role: { key: query.role } } } } : {}),
        ...(q
          ? {
              OR: [
                { phone: { contains: q, mode: 'insensitive' as const } },
                { email: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, query.limit ?? 50),
      select: {
        id: true, phone: true, email: true, status: true, locale: true, createdAt: true,
        userRoles: {
          select: {
            id: true,
            verificationStatus: true,
            badgeTier: true,
            role: { select: { key: true } },
          },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      phone: u.phone,
      email: u.email,
      status: u.status,
      locale: u.locale,
      createdAt: u.createdAt,
      roles: u.userRoles.map((r) => ({
        key: r.role.key,
        verificationStatus: r.verificationStatus,
        badgeTier: r.badgeTier,
      })),
    }));
  }

  /**
   * Suspend, ban or reactivate.
   *
   * A ban also deletes every refresh token: `status` is only checked when a
   * session is created, so without this a banned user would keep working until
   * their access token happened to expire.
   */
  async setStatus(adminId: string, userId: string, status: string, reason: string, ip?: string) {
    if (!STATUSES.includes(status as UserStatus)) {
      throw new BadRequestException(`status must be one of ${STATUSES.join(', ')}`);
    }
    if (status !== 'active' && !reason?.trim()) {
      throw new BadRequestException('A reason is required to suspend or ban');
    }
    if (userId === adminId) throw new BadRequestException('You cannot change your own status');

    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: status as UserStatus },
      select: { id: true, status: true },
    });
    if (status !== 'active') {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }

    await this.audit.log({
      actorId: adminId,
      action: `user.${status}`,
      entityType: 'user',
      entityId: userId,
      before: { status: user.status },
      after: { status: updated.status, reason: reason?.trim() || null },
      ip,
    });
    return updated;
  }

  /** Grants a role. Admin is deliberately not grantable through this path. */
  async grantRole(adminId: string, userId: string, roleKey: string, ip?: string) {
    if (roleKey === 'admin') {
      throw new BadRequestException('Admin cannot be granted from the user console');
    }
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId, deletedAt: null }, select: { id: true } }),
      this.prisma.role.findUnique({ where: { key: roleKey } }),
    ]);
    if (!user) throw new NotFoundException('User not found');
    if (!role) throw new BadRequestException(`Unknown role: ${roleKey}`);

    const existing = await this.prisma.userRole.findFirst({ where: { userId, roleId: role.id } });
    if (existing) throw new BadRequestException('User already holds that role');

    // A granted professional role still has to be verified the normal way —
    // an admin handing out a role must not bypass the §4 document check.
    await this.prisma.userRole.create({
      data: { userId, roleId: role.id, verificationStatus: 'unverified', badgeTier: 'unverified' },
    });
    await this.audit.log({
      actorId: adminId,
      action: 'user.role.grant',
      entityType: 'user',
      entityId: userId,
      after: { roleKey },
      ip,
    });
    return { userId, roleKey, verificationStatus: 'unverified' };
  }

  async revokeRole(adminId: string, userId: string, roleKey: string, ip?: string) {
    if (roleKey === 'customer') {
      throw new BadRequestException('The customer baseline cannot be revoked');
    }
    const { count } = await this.prisma.userRole.deleteMany({
      where: { userId, role: { key: roleKey } },
    });
    if (count === 0) throw new NotFoundException('User does not hold that role');

    await this.audit.log({
      actorId: adminId,
      action: 'user.role.revoke',
      entityType: 'user',
      entityId: userId,
      before: { roleKey },
      ip,
    });
    return { userId, roleKey, revoked: true };
  }
}
