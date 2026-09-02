import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RegionsService } from './regions.service';

/** Regions taxonomy (Plan §1) for pickers, filters, and landing pages. */
@Controller('regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Public()
  @Get()
  list() {
    return this.regions.listTopLevel();
  }

  /** Everything a region landing page renders, in one call (§6.1 SEO). */
  @Public()
  @Get(':slug')
  detail(@Param('slug') slug: string) {
    return this.regions.detail(slug);
  }
}
