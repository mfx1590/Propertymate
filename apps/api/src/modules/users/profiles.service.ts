import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  ApplicableRoleKey,
  UpdateAgencyProfileDto,
  UpdateAgentProfileDto,
  UpdateDeveloperProfileDto,
} from './dto/profiles.dto';

/**
 * Role assignments + profile extensions (Plan §2.2).
 * Owner is usable immediately (owner documents are checked per-listing, §3);
 * professional roles start `pending` and stay locked out of listing/leads
 * until the verification engine (step 4) marks them `verified`.
 */
const IMMEDIATE_ROLES: ApplicableRoleKey[] = ['owner'];

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async applyForRole(userId: string, roleKey: ApplicableRoleKey, ip?: string) {
    const role = await this.prisma.role.findUnique({ where: { key: roleKey } });
    if (!role) throw new BadRequestException('Unknown role');

    const existing = await this.prisma.userRole.findUnique({
      where: { userId_roleId: { userId, roleId: role.id } },
    });
    if (existing) throw new ConflictException(`You already hold the ${roleKey} role`);

    const immediate = IMMEDIATE_ROLES.includes(roleKey);
    const userRole = await this.prisma.userRole.create({
      data: {
        userId,
        roleId: role.id,
        verificationStatus: immediate ? 'verified' : 'pending',
        badgeTier: immediate ? 'verified' : 'pending',
      },
      include: { role: { select: { key: true, name: true } } },
    });

    await this.createProfileExtension(userId, roleKey);

    await this.audit.log({
      actorId: userId,
      action: 'user_role.apply',
      entityType: 'user_role',
      entityId: userRole.id,
      after: { roleKey, verificationStatus: userRole.verificationStatus },
      ip,
    });

    return {
      role: userRole.role,
      verificationStatus: userRole.verificationStatus,
      badgeTier: userRole.badgeTier,
      requiredDocuments: await this.getProfileRequirements(roleKey),
    };
  }

  async listMyRoles(userId: string) {
    return this.prisma.userRole.findMany({
      where: { userId },
      select: {
        verificationStatus: true,
        badgeTier: true,
        createdAt: true,
        role: { select: { key: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getProfile(userId: string, roleKey: string) {
    await this.assertHoldsRole(userId, roleKey);
    const profile = await this.findProfileRow(userId, roleKey);
    if (profile === undefined) {
      throw new BadRequestException(`Role ${roleKey} has no editable profile`);
    }
    return profile ?? {};
  }

  async updateProfile(userId: string, roleKey: string, body: Record<string, unknown>, ip?: string) {
    await this.assertHoldsRole(userId, roleKey);
    const before = await this.findProfileRow(userId, roleKey);

    // strict field whitelist — computed fields (dealCount, ratingAvg…) must
    // never be settable through this endpoint
    let after: unknown;
    switch (roleKey) {
      case 'solo_agent': {
        const dto = await this.validateDto(UpdateAgentProfileDto, body);
        after = await this.prisma.agentProfile.update({
          where: { userId },
          data: { licenseNo: dto.licenseNo, bio: dto.bio, regions: dto.regions },
        });
        break;
      }
      case 'agency': {
        const dto = await this.validateDto(UpdateAgencyProfileDto, body);
        after = await this.prisma.agencyProfile.update({
          where: { userId },
          data: {
            companyName: dto.companyName,
            regNo: dto.regNo,
            taxNo: dto.taxNo,
            address: dto.address,
            about: dto.about,
          },
        });
        break;
      }
      case 'developer': {
        const dto = await this.validateDto(UpdateDeveloperProfileDto, body);
        after = await this.prisma.developerProfile.update({
          where: { userId },
          data: {
            companyName: dto.companyName,
            regNo: dto.regNo,
            taxNo: dto.taxNo,
            about: dto.about,
          },
        });
        break;
      }
      default:
        throw new BadRequestException(`Role ${roleKey} has no editable profile`);
    }

    await this.audit.log({
      actorId: userId,
      action: 'profile.update',
      entityType: `${roleKey}_profile`,
      entityId: userId,
      before: before as object,
      after: after as object,
      ip,
    });
    return after;
  }

  /** Requirements config drives the document-upload UI (Plan §2.2). */
  async getProfileRequirements(roleKey: string) {
    return this.prisma.verificationRequirement.findMany({
      where: { context: 'profile', role: { key: roleKey } },
      select: {
        documentType: true,
        isRequired: true,
        titleI18n: true,
        helpI18n: true,
        sortOrder: true,
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async validateDto<T extends object>(cls: new () => T, body: Record<string, unknown>): Promise<T> {
    const dto = plainToInstance(cls, body);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException(
        errors.flatMap((e) => Object.values(e.constraints ?? {})),
      );
    }
    return dto;
  }

  private async assertHoldsRole(userId: string, roleKey: string) {
    const held = await this.prisma.userRole.findFirst({
      where: { userId, role: { key: roleKey } },
    });
    if (!held) throw new NotFoundException(`You do not hold the ${roleKey} role`);
  }

  /** undefined = role has no profile table; null = row missing (shouldn't happen after apply). */
  private async findProfileRow(userId: string, roleKey: string) {
    switch (roleKey) {
      case 'solo_agent':
        return this.prisma.agentProfile.findUnique({ where: { userId } });
      case 'agency':
        return this.prisma.agencyProfile.findUnique({ where: { userId } });
      case 'developer':
        return this.prisma.developerProfile.findUnique({ where: { userId } });
      case 'owner':
        return this.prisma.ownerProfile.findUnique({ where: { userId } });
      default:
        return undefined;
    }
  }

  private async createProfileExtension(userId: string, roleKey: ApplicableRoleKey) {
    switch (roleKey) {
      case 'owner':
        await this.prisma.ownerProfile.create({ data: { userId } });
        break;
      case 'solo_agent':
        await this.prisma.agentProfile.create({ data: { userId } });
        break;
      case 'agency':
        await this.prisma.agencyProfile.create({ data: { userId, companyName: '' } });
        break;
      case 'developer':
        await this.prisma.developerProfile.create({ data: { userId, companyName: '' } });
        break;
    }
  }
}
