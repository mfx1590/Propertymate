import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { InsightsService } from './insights.service';

/**
 * Public market data (§6.1). Unauthenticated on purpose — these pages are
 * acquisition surface, and the numbers on them are aggregates of already-public
 * asking prices. Nothing here reaches an individual listing or person.
 */
@SkipThrottle()
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Public()
  @Get('valuation')
  valuation(
    @Query('kind') kind: string,
    @Query('region') region: string,
    @Query('areaM2') areaM2: string,
    @Query('bedrooms') bedrooms?: string,
  ) {
    return this.insights.valuation({
      kind,
      region,
      areaM2: Number(areaM2),
      bedrooms: bedrooms === undefined || bedrooms === '' ? undefined : Number(bedrooms),
    });
  }

  @Public()
  @Get('regions/:slug')
  regionSeries(@Param('slug') slug: string) {
    return this.insights.regionSeries(slug);
  }
}

/** Ops/testing trigger, same prefix as the other sweeps (§0 step 14 pattern). */
@RequirePermissions('user.manage')
@Controller('admin/jobs')
export class InsightsAdminController {
  constructor(private readonly insights: InsightsService) {}

  /** Computes the CURRENT month, so a fresh deploy has data today. */
  @Post('market-snapshot')
  run() {
    return this.insights.runSnapshot();
  }
}
