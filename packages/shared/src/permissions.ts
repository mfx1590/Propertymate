/**
 * Permission catalogue. Seeded into the `permissions` table; RBAC guards
 * check these keys. Deny by default (Plan §11).
 */
export const PERMISSION_KEYS = [
  // listings
  'listing.create',
  'listing.update.own',
  'listing.delete.own',
  'listing.delegate',
  'listing.manage.mandated',
  'listing.confirm_availability',
  // projects (developer inventory)
  'project.create',
  'project.update.own',
  'project.unit.manage',
  'project.update.publish',
  // discovery
  'search.saved.manage',
  'favorite.manage',
  // viewings & offers
  'viewing.request',
  'viewing.host',
  'offer.create',
  'offer.respond',
  // chat
  'chat.participate',
  // deals
  'deal.participate',
  'deal.stage.complete',
  'deal.document.upload',
  // ratings & disputes
  'rating.create',
  'dispute.open',
  // agency team
  'agency.agents.manage',
  // admin
  'verification.review',
  'user.manage',
  'listing.moderate',
  'dispute.resolve',
  'analytics.view',
  'audit.view',
  'cms.manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
