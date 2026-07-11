import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSavedSearchDto } from './dto/properties.dto';

@Controller('users/me/saved-searches')
export class SavedSearchesController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions('search.saved.manage')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.savedSearch.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
    });
  }

  @RequirePermissions('search.saved.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSavedSearchDto) {
    return this.prisma.savedSearch.create({
      data: {
        userId: user.sub,
        name: dto.name,
        query: dto.query as object,
        alertChannel: dto.alertChannel ?? 'email',
      },
    });
  }

  @RequirePermissions('search.saved.manage')
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.prisma.savedSearch.deleteMany({ where: { id, userId: user.sub } });
    return { ok: true };
  }
}
