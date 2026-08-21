import type { BadgeTier, RoleKey, VerificationStatus } from '@propverify/shared';

/**
 * Response shapes for the endpoints this app consumes. Kept structurally in
 * step with apps/web/src/lib/*, which reads the same routes — the enums and
 * role keys come from `@propverify/shared` so those cannot drift at all.
 */
export interface MeRole {
  verificationStatus: VerificationStatus;
  badgeTier: BadgeTier;
  role: { key: RoleKey; name: string };
}

export interface Me {
  id: string;
  phone: string | null;
  email: string | null;
  locale: string;
  avatarUrl: string | null;
  status: string;
  userRoles: MeRole[];
}

export interface SearchHit {
  id: string;
  kind: string;
  title: string;
  regionSlug: string;
  regionName: string;
  district: string | null;
  priceBaseGbp: number;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  deedType: string;
  furnished: boolean;
  coverUrl: string | null;
}

export interface SearchSuggestions {
  relax: { filter: string; totalHits: number }[];
  regions: { slug: string; nameI18n: Record<string, string>; totalHits: number; distanceKm: number | null }[];
  totalLive: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  totalHits: number;
  page: number;
  totalPages: number;
  suggestions?: SearchSuggestions;
}

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
  viewCount: number;
  saveCount: number;
  createdAt: string;
  media: PropertyMedia[];
  region: { slug: string; nameI18n: Record<string, string>; lat?: number; lng?: number };
  isOwner?: boolean;
}

export interface RegionInfo {
  id: string;
  slug: string;
  nameI18n: Record<string, string>;
  lat: number | null;
  lng: number | null;
}

export interface Viewing {
  id: string;
  status: string;
  scheduledAt: string;
  notes: string | null;
  customerId: string;
  hostUserId: string;
  property: { id: string; titleI18n: Record<string, string>; region: { slug: string } };
}

export interface Conversation {
  id: string;
  property: { id: string; titleI18n: Record<string, string>; media: { url: string }[] } | null;
  myRole: string;
  /** The §2.4 reveal gate — the other party stays unnamed until it opens. */
  anonymous: boolean;
  lastMessage: { body: string; createdAt: string } | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  /** True when contact details were stripped by the §13.6 anti-bypass filter. */
  bodyScrubbed: boolean;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  templateKey: string;
  title: string | null;
  body: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

/** `GET /users/me/favorites` returns the properties themselves, not join rows. */
export type Favorite = Property;

export interface SavedSearch {
  id: string;
  name: string;
  query: Record<string, string>;
  alertChannel: string | null;
  createdAt: string;
}
