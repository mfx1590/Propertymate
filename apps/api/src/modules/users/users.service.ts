import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        phone: true,
        phoneVerifiedAt: true,
        email: true,
        locale: true,
        avatarUrl: true,
        status: true,
        createdAt: true,
        userRoles: {
          select: {
            verificationStatus: true,
            badgeTier: true,
            role: { select: { key: true, name: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
