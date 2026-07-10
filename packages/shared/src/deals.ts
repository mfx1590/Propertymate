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
