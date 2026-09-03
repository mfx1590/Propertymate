import { BadRequestException, Injectable } from '@nestjs/common';
import { POIS, POI_CATEGORIES, type Poi, type PoiCategory } from './poi.data';

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** GeoJSON `Feature<Point>`, so a map client can consume it without a shim. */
export interface PoiFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { category: PoiCategory; name: string; nameTr?: string };
}

export interface PoiFeatureCollection {
  type: 'FeatureCollection';
  features: PoiFeature[];
}

export interface NearestPoi {
  category: PoiCategory;
  id: string;
  name: string;
  nameTr?: string;
  lat: number;
  lng: number;
  /** Straight-line, to one decimal. Not a driving distance — see `pois.data`. */
  distanceKm: number;
}

/**
 * Map layers for §6.1. A static catalogue in code, served as GeoJSON.
 *
 * Note the coordinate order: GeoJSON is `[lng, lat]` and every other geo
 * surface in this codebase is `{ lat, lng }`. The flip happens here, once,
 * rather than in each caller.
 */
@Injectable()
export class PoisService {
  private toFeature(p: Poi): PoiFeature {
    return {
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { category: p.category, name: p.name, ...(p.nameTr ? { nameTr: p.nameTr } : {}) },
    };
  }

  /** Parses the `category` query param — one, several, or all of them. */
  private resolveCategories(raw?: string): PoiCategory[] {
    if (!raw) return [...POI_CATEGORIES];
    const asked = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const bad = asked.filter((c) => !POI_CATEGORIES.includes(c as PoiCategory));
    if (bad.length) {
      throw new BadRequestException(
        `Unknown POI category: ${bad.join(', ')}. Known: ${POI_CATEGORIES.join(', ')}`,
      );
    }
    return asked as PoiCategory[];
  }

  collection(category?: string): PoiFeatureCollection {
    const wanted = this.resolveCategories(category);
    return {
      type: 'FeatureCollection',
      features: POIS.filter((p) => wanted.includes(p.category)).map((p) => this.toFeature(p)),
    };
  }

  /**
   * The nearest of each category to a point — what a listing page answers when
   * a buyer abroad asks "how far is the beach?".
   *
   * One per category rather than a radius list: three named answers are read;
   * twenty ranked pins are scrolled past.
   */
  nearest(lat: number, lng: number): NearestPoi[] {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('lat and lng are required');
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new BadRequestException('lat/lng out of range');
    }

    const out: NearestPoi[] = [];
    for (const category of POI_CATEGORIES) {
      let best: { poi: Poi; km: number } | null = null;
      for (const poi of POIS) {
        if (poi.category !== category) continue;
        const km = haversineKm(lat, lng, poi.lat, poi.lng);
        if (!best || km < best.km) best = { poi, km };
      }
      if (!best) continue;
      out.push({
        category,
        id: best.poi.id,
        name: best.poi.name,
        ...(best.poi.nameTr ? { nameTr: best.poi.nameTr } : {}),
        lat: best.poi.lat,
        lng: best.poi.lng,
        distanceKm: Math.round(best.km * 10) / 10,
      });
    }
    return out;
  }
}
