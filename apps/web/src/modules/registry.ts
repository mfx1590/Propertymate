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
      { labelKey: 'profile', href: '/dashboard/profile/agency' },
    ],
  },
  developer: {
    roleKey: 'developer',
    labelKey: 'developer',
    requiresVerification: true,
    menu: [
      { labelKey: 'projects', href: '/dashboard/projects' },
      { labelKey: 'leads', href: '/dashboard/leads' },
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
