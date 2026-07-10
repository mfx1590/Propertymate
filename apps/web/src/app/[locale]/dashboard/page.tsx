'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiPost } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import type { RequirementConfig } from '../../../lib/types';

const APPLICABLE = ['owner', 'solo_agent', 'agency', 'developer'] as const;

const STATUS_STYLES: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  unverified: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-50 text-red-700',
};

export default function DashboardOverview() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { me, refreshMe } = useAuth();
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRequirements, setLastRequirements] = useState<{
    roleKey: string;
    docs: RequirementConfig[];
  } | null>(null);

  if (!me) return null;

  const heldKeys = new Set(me.userRoles.map((ur) => ur.role.key));
  const applicable = APPLICABLE.filter((k) => !heldKeys.has(k));

  const apply = async (roleKey: string) => {
    setError(null);
    setBusyRole(roleKey);
    try {
      const res = await apiPost<{ requiredDocuments: RequirementConfig[] }>('/users/me/roles', {
        roleKey,
      });
      setLastRequirements({ roleKey, docs: res.requiredDocuments });
      await refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyRole(null);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('overview.title')}</h1>

      {/* roles held */}
      <section className="mt-6">
        <h2 className="font-semibold text-gray-700">{t('overview.yourRoles')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {me.userRoles.map((ur) => (
            <div key={ur.role.key} className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t(`roles.${ur.role.key}`)}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[ur.verificationStatus] ?? STATUS_STYLES.unverified}`}
                >
                  {t(`status.${ur.verificationStatus}`)}
                </span>
              </div>
              {ur.verificationStatus === 'pending' && (
                <p className="mt-2 text-xs text-gray-500">{t('overview.pendingHint')}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* requirements shown right after applying */}
      {lastRequirements && lastRequirements.docs.length > 0 && (
        <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-semibold text-amber-900">
            {t('overview.requirementsTitle', { role: t(`roles.${lastRequirements.roleKey}`) })}
          </h3>
          <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
            {lastRequirements.docs.map((d) => (
              <li key={d.documentType}>
                {d.titleI18n[locale] ?? d.titleI18n.en}
                {!d.isRequired && ` (${t('overview.optional')})`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-700">{t('overview.uploadComingSoon')}</p>
        </section>
      )}

      {/* apply for more roles */}
      {applicable.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold text-gray-700">{t('overview.becomeTitle')}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {applicable.map((roleKey) => (
              <div key={roleKey} className="rounded-xl border border-gray-200 p-4">
                <h3 className="font-medium">{t(`roles.${roleKey}`)}</h3>
                <p className="mt-1 text-sm text-gray-500">{t(`roleDescriptions.${roleKey}`)}</p>
                <button
                  className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busyRole !== null}
                  onClick={() => apply(roleKey)}
                >
                  {busyRole === roleKey ? '…' : t('overview.apply')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
