import { Controller, Get, Post, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SearchService } from './search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Ops: rebuild the whole index from the DB (e.g. after a bulk import). */
  @RequirePermissions('user.manage')
  @Post('reindex')
  reindex() {
    return this.search.reindexAll();
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
