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
  _geo?: { lat: number; lng: number };
}

/**
 * Ways out of a zero-result search. The API only returns these when there are
 * no hits, and only for routes it has confirmed do have results — so anything
 * listed here can be offered to the user as a real next step.
 */
export const RELAXABLE_FILTERS = [
  'q', 'kind', 'region', 'minPrice', 'maxPrice', 'minBeds', 'deedType', 'furnished',
] as const;

export type RelaxableFilter = (typeof RELAXABLE_FILTERS)[number];

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
