/**
 * Developer project module types (Plan §6.3), mirroring `lib/listings.ts`.
 * The API stores name/description as i18n JSON but currently only writes `en`;
 * `pickI18n` keeps the read side locale-aware for when the other locales land.
 */
export type ProjectStatus = 'draft' | 'pending_verification' | 'live' | 'paused' | 'archived';
export type UnitStatus = 'available' | 'reserved' | 'sold';

export interface ProjectMedia {
  id: string;
  url: string;
  sortOrder: number;
}

export interface PaymentPlan {
  name: string;
  downPaymentPct: number;
  installments: number;
  installmentFrequency?: 'monthly' | 'quarterly';
  onDeliveryPct?: number;
}

export interface ProjectUnit {
  id: string;
  unitNo: string;
  type: string | null;
  bedrooms: number | null;
  areaM2: number | null;
  floor: number | null;
  priceAmount: string;
  priceCurrency: string;
  status: UnitStatus;
}

/** Availability roll-up served with every project payload. */
export interface UnitStats {
  total: number;
  available: number;
  reserved: number;
  sold: number;
  priceFrom: number | null;
  priceTo: number | null;
  currency: string | null;
  bedroomOptions: number[];
}

export interface ProjectUpdateItem {
  id: string;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  publishedAt: string;
}

export interface RegionRef {
  slug: string;
  nameI18n: Record<string, string>;
  lat?: number | null;
  lng?: number | null;
}

/** `GET /projects/mine` — the developer's own board. */
export interface MyProject {
  id: string;
  nameI18n: Record<string, string>;
  descriptionI18n: Record<string, string>;
  status: ProjectStatus;
  lat: number | null;
  lng: number | null;
  deliveryDate: string | null;
  paymentPlans: PaymentPlan[] | null;
  createdAt: string;
  media: ProjectMedia[];
  region: RegionRef;
  _count: { units: number; updates: number };
  unitStats: UnitStats;
}

/** `GET /projects/:id` — public detail (also serves the owning developer a preview). */
export interface ProjectDetail extends Omit<MyProject, '_count'> {
  units: ProjectUnit[];
  updates: ProjectUpdateItem[];
  isDeveloper: boolean;
  developer: {
    id: string;
    developerProfile: { companyName: string | null; about: string | null } | null;
    userRoles: Array<{ badgeTier: string | null; verificationStatus: string }>;
  };
}

/** `GET /projects` — public directory card. */
export interface ProjectCard {
  id: string;
  name: string;
  region: RegionRef;
  lat: number | null;
  lng: number | null;
  deliveryDate: string | null;
  coverUrl: string | null;
  developerName: string | null;
  unitStats: UnitStats;
}

export interface ProjectRequirement {
  documentType: string;
  isRequired: boolean;
  titleI18n: Record<string, string>;
  helpI18n: Record<string, string> | null;
  sortOrder: number;
}

/** `POST /projects/:id/units/import` — per-row outcome, never a whole-batch failure. */
export interface ImportReport {
  created: number;
  updated: number;
  skipped: Array<{ line: number; reason: string }>;
}

export interface ProjectLeads {
  inquiries: Array<{
    conversationId: string;
    createdAt: string;
    lastMessageAt: string;
    preview: string | null;
  }>;
  reservations: Array<{
    dealId: string;
    status: string;
    currentStageKey: string | null;
    createdAt: string;
    unit: { id: string; unitNo: string; priceAmount: string; priceCurrency: string } | null;
    priceAgreed: string | null;
    currency: string | null;
  }>;
}

export const pickI18n = (field: Record<string, string> | null | undefined, locale: string) =>
  field?.[locale] || field?.en || '';

export const UNIT_STATUS_STYLES: Record<UnitStatus, string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  reserved: 'bg-amber-50 text-amber-700 border-amber-200',
  sold: 'bg-gray-100 text-gray-400 border-gray-200',
};

export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_verification: 'bg-amber-50 text-amber-700',
  live: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-gray-100 text-gray-500',
  archived: 'bg-gray-100 text-gray-400',
};
