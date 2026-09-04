import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { OcrService } from '../../common/ocr/ocr.service';
import { isOcrDocument } from '../../common/identity-documents';
import {
  ApplicableRoleKey,
  UpdateAgencyProfileDto,
  UpdateAgentProfileDto,
  UpdateDeveloperProfileDto,
  UpdateLawyerProfileDto,
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
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
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

    // professional roles enter the admin verification queue (Plan §4)
    if (!immediate) {
      await this.prisma.verificationItem.create({
        data: {
          entityType: 'profile',
          entityId: userRole.id,
          status: 'queued',
          slaDueAt: new Date(Date.now() + 24 * 3_600_000),
        },
      });
    }

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
      case 'lawyer': {
        const dto = await this.validateDto(UpdateLawyerProfileDto, body);
        after = await this.prisma.lawyerProfile.update({
          where: { userId },
          data: {
            firmName: dto.firmName,
            barNo: dto.barNo,
            bio: dto.bio,
            regions: dto.regions,
            languages: dto.languages,
            feeModel: dto.feeModel,
            feeNote: dto.feeNote,
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

  /** Profile verification docs — private bucket, tied to the user_role under review. */
  async addProfileDocument(
    userId: string,
    roleKey: string,
    documentType: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    ip?: string,
  ) {
    const userRole = await this.prisma.userRole.findFirst({
      where: { userId, role: { key: roleKey } },
    });
    if (!userRole) throw new NotFoundException(`You do not hold the ${roleKey} role`);
    if (file.size > 20 * 1024 * 1024) throw new BadRequestException('Document exceeds 20MB limit');

    const key = `profiles/${userRole.id}/${documentType}-${Date.now()}`;
    await this.storage.putPrivateDocument(key, file.buffer, file.mimetype);
    const doc = await this.prisma.document.create({
      data: {
        ownerUserId: userId,
        entityType: 'profile',
        entityId: userRole.id,
        documentType,
        storageKey: key,
        mime: file.mimetype,
        size: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        status: 'pending',
      },
    });

    // §13.2 step 28: read the document number off identity papers, in the
    // background — a slow OCR pass must not sit between Upload and "done".
    if (isOcrDocument(documentType, file.mimetype)) {
      void this.ocr.processDocument(doc.id, file.buffer);
    }

    // re-upload after a rejection requeues the profile for review
    const open = await this.prisma.verificationItem.count({
      where: { entityType: 'profile', entityId: userRole.id, status: { in: ['queued', 'claimed'] } },
    });
    if (open === 0 && userRole.verificationStatus !== 'verified') {
      await this.prisma.verificationItem.create({
        data: {
          entityType: 'profile',
          entityId: userRole.id,
          status: 'queued',
          slaDueAt: new Date(Date.now() + 24 * 3_600_000),
        },
      });
    }

    await this.audit.log({
      actorId: userId,
      action: 'document.upload',
      entityType: 'document',
      entityId: doc.id,
      after: { roleKey, documentType },
      ip,
    });
    return { id: doc.id, documentType: doc.documentType, status: doc.status, uploadedAt: doc.uploadedAt };
  }

  async listProfileDocuments(userId: string, roleKey: string) {
    const userRole = await this.prisma.userRole.findFirst({
      where: { userId, role: { key: roleKey } },
    });
    if (!userRole) throw new NotFoundException(`You do not hold the ${roleKey} role`);
    return this.prisma.document.findMany({
      where: { entityType: 'profile', entityId: userRole.id, deletedAt: null },
      select: {
        id: true,
        documentType: true,
        status: true,
        rejectReasonCode: true,
        rejectNote: true,
        docNumber: true,
        uploadedAt: true,
      },
      orderBy: { uploadedAt: 'desc' },
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
      case 'lawyer':
        return this.prisma.lawyerProfile.findUnique({ where: { userId } });
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
      case 'lawyer':
        await this.prisma.lawyerProfile.create({ data: { userId } });
        // The §2.2 service-provider abstraction, populated for the first time.
        // Created on application rather than on approval so an unverified lawyer
        // still has the row — the directory filters on the ROLE's verification
        // status, and a provider record that only appeared on approval would
        // make "why am I not listed yet" unanswerable from the data.
        await this.prisma.serviceProvider.create({
          data: { userId, serviceType: 'lawyer' },
        });
        break;
    }
  }
}
