export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface PropertyMedia {
  id: string;
  url: string;
  sortOrder: number;
}

export interface Property {
  id: string;
  kind: 'resale' | 'rental';
  titleI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  district: string | null;
  lat: number | null;
  lng: number | null;
  priceAmount: string;
  priceCurrency: string;
  priceBaseGbp: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  plotM2: number | null;
  deedType: string;
  furnished: boolean;
  features: string[] | null;
  status: string;
  availabilityConfirmedAt: string | null;
  viewCount: number;
  saveCount: number;
  createdAt: string;
  media: PropertyMedia[];
  region: { slug: string; nameI18n: Record<string, string>; lat?: number; lng?: number };
  isOwner?: boolean;
}

export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  regionSlug: string;
  regionName: string;
  district: string | null;
  priceBaseGbp: number;
  priceAmount: number;
  priceCurrency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  deedType: string;
  furnished: boolean;
  coverUrl: string | null;
  /** §6.1: percent below the highest price this listing has asked, if any. */
  priceReducedPct?: number | null;
  _geo?: { lat: number; lng: number };
}

/**
 * Ways out of a zero-result search. The API only returns these when there are
 * no hits, and only for routes it has confirmed do have results — so anything
 * listed here can be offered to the user as a real next step.
 */
export const RELAXABLE_FILTERS = [
  'q', 'kind', 'region', 'minPrice', 'maxPrice', 'minBeds', 'deedType', 'furnished', 'polygon',
] as const;

export type RelaxableFilter = (typeof RELAXABLE_FILTERS)[number];

export const POI_CATEGORIES = ['university', 'beach', 'hospital'] as const;
export type PoiCategory = (typeof POI_CATEGORIES)[number];

/** One vertex of a drawn search area, in click order. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * The wire format the API parses: `lat,lng;lat,lng;…`. Kept in one place so
 * the search URL, the saved-search payload and the alert sweep can never
 * disagree about what a drawn area looks like.
 */
export const encodePolygon = (points: LatLng[]) =>
  points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(';');

export function decodePolygon(raw: string | null | undefined): LatLng[] {
  if (!raw) return [];
  const points = raw
    .split(';')
    .map((pair) => pair.split(','))
    .filter((parts) => parts.length === 2)
    .map(([lat, lng]) => ({ lat: Number(lat), lng: Number(lng) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  // Fewer than three vertices is not an area; the API rejects it, so never
  // send one — a half-typed URL should show every listing, not an error page.
  return points.length >= 3 ? points : [];
}

/** GeoJSON as served by `GET /pois` — note the `[lng, lat]` coordinate order. */
export interface PoiFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { category: PoiCategory; name: string; nameTr?: string };
}

export interface NearestPoi {
  category: PoiCategory;
  id: string;
  name: string;
  nameTr?: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

export interface SearchSuggestions {
  relax: { filter: RelaxableFilter; totalHits: number }[];
  regions: { slug: string; nameI18n: Record<string, string>; totalHits: number; distanceKm: number | null }[];
  totalLive: number;
}

export interface RegionInfo {
  id: string;
  slug: string;
  nameI18n: Record<string, string>;
  lat: number | null;
  lng: number | null;
}

export const FEATURE_KEYS = [
  'pool', 'sea_view', 'mountain_view', 'garden', 'garage', 'balcony',
  'air_conditioning', 'solar_water', 'generator', 'white_goods', 'elevator', 'fireplace',
] as const;

export const fmtGbp = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);

export const fmtMoney = (n: number, currency: string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
