export type PropertyKind = 'resale' | 'rental';

export type PropertyStatus =
  | 'draft'
  | 'pending_verification'
  | 'live'
  | 'paused'
  | 'under_offer'
  | 'sold'
  | 'rented'
  | 'archived';

/** TRNC title deed types — shown publicly on verified listings (Plan §3, §4). */
export type DeedType = 'turkish' | 'exchange' | 'allocation' | 'foreign' | 'na';

export type MediaType = 'photo' | 'video' | 'tour360';

export const MIN_LISTING_PHOTOS = 5;

/** Availability freshness rule (Plan §4): confirm every 90 days, nudge at 83/88/90. */
export const AVAILABILITY_CONFIRM_DAYS = 90;
export const AVAILABILITY_NUDGE_DAYS = [83, 88, 90] as const;

/** Price anomaly flag threshold vs region median price/m² (Plan §4). */
export const PRICE_ANOMALY_THRESHOLD = 0.4;

export type Currency = 'GBP' | 'EUR' | 'USD' | 'TRY';
export const BASE_CURRENCY: Currency = 'GBP';
export const CURRENCIES: Currency[] = ['GBP', 'EUR', 'USD', 'TRY'];
