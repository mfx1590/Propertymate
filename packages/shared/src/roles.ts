/**
 * Roles are DATA, not code branches (Plan §2.2).
 * These keys mirror the seeded `roles` table. Adding a lateral role later
 * (lawyer, furniture, movers...) means adding a key here + a seed row —
 * never an `if (role === ...)` branch in feature code.
 */
export const ROLE_KEYS = [
  'customer',
  'owner',
  'solo_agent',
  'agency',
  // an agent who belongs to an agency (§13.1). Same working permissions as a
  // solo agent, but the org admin manages the account and the member is not
  // individually selectable in the find-my-agent directory — the agency is.
  'agency_member',
  'developer',
  'admin',
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ADMIN_SUB_ROLES = [
  'super_admin',
  'verification_officer',
  'support_agent',
  'content_moderator',
] as const;

export type AdminSubRole = (typeof ADMIN_SUB_ROLES)[number];

/** Lateral roles attach to deals as service providers (Plan §2.2). Empty at launch. */
export const SERVICE_TYPES = [
  'lawyer',
  'furniture',
  'movers',
  'insurance',
  'property_management',
  'notary_translation',
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export type BadgeTier = 'unverified' | 'pending' | 'verified' | 'trusted_partner';
