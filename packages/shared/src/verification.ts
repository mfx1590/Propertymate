export type DocumentStatus = 'pending' | 'approved' | 'rejected';

/** Per-document rejection reasons (Plan §4 step 5). */
export const REJECT_REASON_CODES = [
  'illegible',
  'expired',
  'name_mismatch',
  'wrong_type',
  'suspected_forgery',
  'other',
] as const;

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

/** What a verification_requirement row applies to. */
export type VerificationContext =
  | 'profile'
  | 'listing_resale'
  | 'listing_rental'
  | 'project';

export type VerificationEntityType = 'profile' | 'listing' | 'project' | 'document';

/** Admin queue SLA target in hours (Plan §4). */
export const VERIFICATION_SLA_HOURS = 24;

/** Document type keys used by verification_requirements + upload UI. */
export const DOCUMENT_TYPES = [
  'title_deed',
  'rental_authority',
  'owner_id',
  'utility_bill',
  'government_id',
  'real_estate_license',
  'selfie_with_id',
  'owner_mandate',
  'business_registration',
  'tax_number',
  'office_address_proof',
  'signatory_id',
  'company_registration',
  'portfolio',
  'construction_permit',
  'project_plans',
  'contract',
  'deposit_receipt',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
