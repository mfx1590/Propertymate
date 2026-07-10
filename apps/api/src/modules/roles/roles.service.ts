import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Union of permission keys across all of the user's role assignments.
   * TODO(perf): add a short-TTL Redis cache once traffic warrants it.
   */
  async getPermissionsForUser(userId: string): Promise<Set<string>> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            rolePermissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    const keys = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) keys.add(rp.permission.key);
    }
    return keys;
  }

  async listRoles() {
    return this.prisma.role.findMany({ select: { id: true, key: true, name: true } });
  }
}
