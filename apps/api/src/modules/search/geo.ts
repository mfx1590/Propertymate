import { BadRequestException } from '@nestjs/common';

/** One vertex of a drawn area, in the order the user clicked it. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * A polygon has to be small enough to send in a query string and large enough
 * to trace a coastline. Leaflet emits a vertex per click, so a hand-drawn area
 * is a dozen points; the cap exists to stop a crafted URL from turning a public
 * endpoint into a CPU sink, not to constrain real drawing.
 */
export const MAX_POLYGON_POINTS = 200;
const MIN_POLYGON_POINTS = 3;

/**
 * `lat,lng;lat,lng;…` — chosen over GeoJSON-in-a-query-param because a drawn
 * area belongs in a shareable, bookmarkable URL alongside the other filters,
 * and JSON there is unreadable once encoded.
 */
export function parsePolygonParam(raw: string | undefined): GeoPoint[] | undefined {
  if (!raw) return undefined;

  const pairs = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (pairs.length < MIN_POLYGON_POINTS) {
    throw new BadRequestException(`A drawn area needs at least ${MIN_POLYGON_POINTS} points`);
  }
  if (pairs.length > MAX_POLYGON_POINTS) {
    throw new BadRequestException(`A drawn area may not exceed ${MAX_POLYGON_POINTS} points`);
  }

  return pairs.map((pair) => {
    const [latRaw, lngRaw, ...rest] = pair.split(',');
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (rest.length > 0 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException(`Malformed polygon point: "${pair}"`);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new BadRequestException(`Polygon point out of range: "${pair}"`);
    }
    return { lat, lng };
  });
}

export interface BoundingBox {
  topRight: GeoPoint;
  bottomLeft: GeoPoint;
}

export function boundingBox(polygon: GeoPoint[]): BoundingBox {
  let minLat = polygon[0].lat;
  let maxLat = polygon[0].lat;
  let minLng = polygon[0].lng;
  let maxLng = polygon[0].lng;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { topRight: { lat: maxLat, lng: maxLng }, bottomLeft: { lat: minLat, lng: minLng } };
}

/**
 * Ray casting, counting crossings of a horizontal ray to the east of the point.
 *
 * Treats lat/lng as plane coordinates, which is wrong in general and correct
 * here: the whole catalogue sits inside roughly 35°N 32–35°E, so there is no
 * antimeridian to wrap and no pole to converge on. A listing exactly on an
 * edge may land either side — a boundary case with no right answer, and not
 * one a user dragging a shape around a bay can perceive.
 */
export function pointInPolygon(point: GeoPoint, polygon: GeoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (!straddles) continue;
    const lngAtLat = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (point.lng < lngAtLat) inside = !inside;
  }
  return inside;
}
