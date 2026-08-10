import type { RoleKey } from '@propverify/shared';

/**
 * Role-module registry (Plan §2.2 "Dashboard shell").
 * The authenticated layout renders navigation from this config — adding a new
 * role's dashboard (e.g. Lawyer in Phase 3) means registering a module here,
 * never editing the shell or sprinkling role checks through pages.
 */
export interface MenuItem {
  /** i18n key under dashboard.menu.* */
  labelKey: string;
  href: string;
}

export interface RoleModule {
  roleKey: RoleKey;
  /** i18n key under dashboard.roles.* */
  labelKey: string;
  menu: MenuItem[];
  /** roles whose dashboards are gated until verification passes */
  requiresVerification: boolean;
}

export const ROLE_MODULES: Partial<Record<RoleKey, RoleModule>> = {
  owner: {
    roleKey: 'owner',
    labelKey: 'owner',
    requiresVerification: false,
    menu: [
      { labelKey: 'myListings', href: '/dashboard/listings' },
      { labelKey: 'leads', href: '/dashboard/leads' },
      { labelKey: 'analytics', href: '/dashboard/analytics' },
    ],
  },
  solo_agent: {
    roleKey: 'solo_agent',
    labelKey: 'soloAgent',
    requiresVerification: true,
    menu: [
      { labelKey: 'myListings', href: '/dashboard/listings' },
      { labelKey: 'mandates', href: '/dashboard/mandates' },
      { labelKey: 'leads', href: '/dashboard/leads' },
      { labelKey: 'analytics', href: '/dashboard/analytics' },
      { labelKey: 'profile', href: '/dashboard/profile/solo_agent' },
    ],
  },
  agency: {
    roleKey: 'agency',
    labelKey: 'agency',
    requiresVerification: true,
    menu: [
      { labelKey: 'myListings', href: '/dashboard/listings' },
      { labelKey: 'team', href: '/dashboard/team' },
      { labelKey: 'leads', href: '/dashboard/leads' },
      { labelKey: 'analytics', href: '/dashboard/analytics' },
      { labelKey: 'profile', href: '/dashboard/profile/agency' },
    ],
  },
  // A member works listings like a solo agent but never manages the org: no
  // team entry, and their analytics are their own, not the agency's rollup.
  agency_member: {
    roleKey: 'agency_member',
    labelKey: 'agencyMember',
    requiresVerification: true,
    menu: [
      { labelKey: 'myListings', href: '/dashboard/listings' },
      { labelKey: 'leads', href: '/dashboard/leads' },
      { labelKey: 'analytics', href: '/dashboard/analytics' },
    ],
  },
  developer: {
    roleKey: 'developer',
    labelKey: 'developer',
    requiresVerification: true,
    menu: [
      { labelKey: 'projects', href: '/dashboard/projects' },
      { labelKey: 'leads', href: '/dashboard/leads' },
      { labelKey: 'analytics', href: '/dashboard/analytics' },
      { labelKey: 'profile', href: '/dashboard/profile/developer' },
    ],
  },
  admin: {
    roleKey: 'admin',
    labelKey: 'admin',
    requiresVerification: false,
    menu: [
      { labelKey: 'verificationQueue', href: '/dashboard/admin/queue' },
      { labelKey: 'mediated', href: '/dashboard/admin/mediated' },
      { labelKey: 'subscriptions', href: '/dashboard/admin/subscriptions' },
      { labelKey: 'platformSettings', href: '/dashboard/admin/settings' },
      { labelKey: 'platformAnalytics', href: '/dashboard/admin/analytics' },
      { labelKey: 'users', href: '/dashboard/admin/users' },
      { labelKey: 'disputes', href: '/dashboard/admin/disputes' },
    ],
  },
  // customer intentionally has no module: customers use the public site
  // (search, favorites, viewings) — the dashboard shows their deals later.
};

/** Menu shown to everyone regardless of role. */
export const COMMON_MENU: MenuItem[] = [
  { labelKey: 'overview', href: '/dashboard' },
  { labelKey: 'messages', href: '/dashboard/messages' },
  { labelKey: 'viewings', href: '/dashboard/viewings' },
  { labelKey: 'offers', href: '/dashboard/offers' },
  { labelKey: 'deals', href: '/dashboard/deals' },
  { labelKey: 'referrals', href: '/dashboard/referrals' },
  { labelKey: 'notificationSettings', href: '/dashboard/settings/notifications' },
];

export function menuForRoles(roleKeys: RoleKey[]): MenuItem[] {
  const seen = new Set<string>();
  const items = [...COMMON_MENU];
  for (const key of roleKeys) {
    const mod = ROLE_MODULES[key];
    if (!mod) continue;
    for (const item of mod.menu) {
      if (!seen.has(item.href)) {
        seen.add(item.href);
        items.push(item);
      }
    }
  }
  return items;
}
