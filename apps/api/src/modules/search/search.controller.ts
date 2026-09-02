import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AlertsService } from './alerts.service';
import { RecommendationsService } from './recommendations.service';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly recommendations: RecommendationsService,
  ) {}


  /** Ops: rebuild the whole index from the DB (e.g. after a bulk import). */
  @RequirePermissions('user.manage')
  @Post('reindex')
  reindex() {
    return this.search.reindexAll();
  }

  /**
   * "Viewers of this also viewed" (§8). Lives under /search rather than
   * /properties/:id/similar because the properties controller keeps `:id` last
   * as a catch-all, and a sibling route there would shadow it.
   */
  @SkipThrottle()
  @Public()
  @Get('similar/:propertyId')
  similar(@Param('propertyId') propertyId: string, @Query('limit') limit?: string) {
    return this.recommendations.similarTo(propertyId, Math.min(12, Number(limit) || 6));
  }

  /** Ops/testing trigger for the nightly co-visitation rebuild. */
  @RequirePermissions('user.manage')
  @Post('recommendations/rebuild')
  rebuildRecommendations() {
    return this.recommendations.rebuild();
  }

  // high-traffic public browse endpoint — not rate-limited (§11 targets auth/chat/inquiry)
  @SkipThrottle()
  @Public()
  @Get('listings')
  listings(
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('region') region?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('minBeds') minBeds?: string,
    @Query('deedType') deedType?: string,
    @Query('furnished') furnished?: string,
    @Query('sort') sort?: 'newest' | 'price_asc' | 'price_desc',
    @Query('page') page?: string,
  ) {
    return this.search.search({
      q,
      kind,
      region,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      minBeds: minBeds ? Number(minBeds) : undefined,
      deedType,
      furnished: furnished === undefined ? undefined : furnished === 'true',
      sort,
      page: page ? Number(page) : undefined,
    });
  }
}

/**
 * Manual triggers for the §6.1 alert sweeps (ops/testing), kept on the same
 * `admin/jobs` prefix as the freshness and reputation sweeps. Without these the
 * only way to exercise an alert is to wait until 07:00.
 */
@RequirePermissions('user.manage')
@Controller('admin/jobs')
export class AlertsAdminController {
  constructor(private readonly alerts: AlertsService) {}

  @Post('saved-search-alerts')
  runSavedSearchAlerts() {
    return this.alerts.runSavedSearchAlerts();
  }

  @Post('price-drop-alerts')
  runPriceDropAlerts() {
    return this.alerts.runPriceDropAlerts();
  }
}
