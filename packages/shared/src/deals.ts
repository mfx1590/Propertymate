import type { ServiceType } from './roles';
import type { DocumentType } from './verification';

export type DealKind = 'purchase' | 'rental';

export type DealStatus = 'active' | 'completed' | 'cancelled';

export type StageStatus = 'pending' | 'active' | 'completed' | 'skipped';

export type DealPartyRole =
  | 'buyer'
  | 'seller'
  | 'agent_buyer_side'
  | 'agent_seller_side'
  | 'lawyer'
  | 'service_provider';

/**
 * Stage definition inside pipeline_templates.stages (Plan §7).
 * `injectableServiceTypes` is the super-app seam: lateral providers
 * attach at declared stages via config only.
 */
export interface PipelineStageDef {
  key: string;
  titleI18n: Record<string, string>;
  requiredDocuments: DocumentType[];
  completesBy: DealPartyRole | 'system' | 'both_parties';
  injectableServiceTypes: ServiceType[];
  notifications: string[];
  /** e.g. permit_process only applies to foreign buyers */
  skippable?: boolean;
}

export const PURCHASE_STAGE_KEYS = [
  'inquiry',
  'viewing',
  'offer',
  'offer_accepted',
  'legal_check',
  'contract_signing',
  'deposit_recorded',
  'permit_process',
  'completion',
  'post_deal',
] as const;

export const RENTAL_STAGE_KEYS = [
  'inquiry',
  'viewing',
  'application',
  'landlord_approval',
  'contract',
  'deposit_recorded',
  'move_in_checklist',
  'active_tenancy',
  'renewal_or_exit',
] as const;

export type ViewingStatus =
  | 'requested'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type OfferStatus =
  | 'submitted'
  | 'countered'
  | 'accepted'
  | 'rejected'
  | 'withdrawn';

/** Both-submit-or-14-days rating reveal rule (Plan §6.5). */
export const RATING_REVEAL_DAYS = 14;

/** trusted_partner badge criteria (Plan §3). */
export const TRUSTED_PARTNER_MIN_DEALS = 5;
export const TRUSTED_PARTNER_MIN_RATING = 4.5;

/**
 * Agent ranking score (Plan §6.5): `f(rating_avg, deal_count, response_time,
 * dispute_rate)`, recomputed nightly. Weights live here rather than in the API
 * so the dashboard can render the same breakdown it scores on — a pro must be
 * able to see WHY they rank where they do.
 */
export const RANKING_WEIGHTS = {
  rating: 40,
  deals: 25,
  responseTime: 20,
  disputeFree: 15,
} as const;

export type RankingFactor = keyof typeof RANKING_WEIGHTS;

/**
 * Bayesian prior for the rating component. With few ratings the score is pulled
 * toward `RANKING_RATING_PRIOR`, so one 5★ deal cannot outrank a long record.
 */
export const RANKING_RATING_PRIOR = 3.5;
export const RANKING_RATING_PRIOR_WEIGHT = 3;

/** Deal count saturates here — beyond it, volume stops buying rank. */
export const RANKING_DEALS_SATURATION = 10;

/** Response time scores 1.0 at instant and 0.0 at this bound. */
export const RANKING_RESPONSE_TARGET_SEC = 24 * 3600;

/** Score assigned to a factor with no data yet (neutral, not zero). */
export const RANKING_UNKNOWN_FACTOR = 0.5;

/** Per-factor 0–1 sub-scores plus the weighted 0–100 total. */
export interface RankingBreakdown {
  factors: Record<RankingFactor, { value: number | null; score: number; weight: number }>;
  score: number;
}
