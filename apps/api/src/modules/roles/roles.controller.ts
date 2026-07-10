import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get()
  listRoles() {
    return this.rolesService.listRoles();
  }

  /** Verification requirements config for a role's profile — drives the upload UI (Plan §2.2). */
  @Public()
  @Get(':key/requirements')
  getRequirements(@Param('key') key: string) {
    return this.prisma.verificationRequirement.findMany({
      where: { context: 'profile', role: { key } },
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
}
