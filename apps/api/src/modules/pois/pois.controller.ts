import { Controller, Get, Query } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { PoisService } from './pois.service';

/**
 * §6.1 POI layers. Public and unauthenticated on purpose — the map is the
 * first thing an anonymous visitor touches, and a static catalogue of
 * universities, beaches and hospitals is not anyone's data.
 */
@SkipThrottle()
@Controller('pois')
export class PoisController {
  constructor(private readonly pois: PoisService) {}

  /** GeoJSON FeatureCollection; `?category=beach,hospital` to narrow. */
  @Public()
  @Get()
  list(@Query('category') category?: string) {
    return this.pois.collection(category);
  }

  /** Nearest university / beach / hospital to a point, with distances. */
  @Public()
  @Get('near')
  near(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.pois.nearest(Number(lat), Number(lng));
  }
}
