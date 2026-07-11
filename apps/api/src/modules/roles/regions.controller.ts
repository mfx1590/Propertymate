import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Regions taxonomy (Plan §1) for pickers, filters, and landing pages. */
@Controller('regions')
export class RegionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  list() {
    return this.prisma.region.findMany({
      where: { parentId: null },
      select: { id: true, slug: true, nameI18n: true, lat: true, lng: true },
      orderBy: { slug: 'asc' },
    });
  }
}
