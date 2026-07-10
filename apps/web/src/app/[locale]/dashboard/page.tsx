'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import type { RequirementConfig } from '../../../lib/types';

const STATUS_STYLES: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  unverified: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-50 text-red-700',
};

export default function DashboardOverview() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { me } = useAuth();
  const [requirements, setRequirements] = useState<Record<string, RequirementConfig[]>>({});

  const pendingKeys = (me?.userRoles ?? [])
    .filter((ur) => ur.verificationStatus === 'pending')
    .map((ur) => ur.role.key);
  const pendingKeysStr = pendingKeys.join(',');

  // for pending roles, show which documents the verification team needs
  useEffect(() => {
    if (!pendingKeysStr) return;
    void Promise.all(
      pendingKeysStr.split(',').map(async (key) => {
        const docs = await apiGet<RequirementConfig[]>(`/roles/${key}/requirements`);
        return [key, docs] as const;
      }),
    ).then((entries) => setRequirements(Object.fromEntries(entries)));
  }, [pendingKeysStr]);

  if (!me) return null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('overview.title')}</h1>

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

      {pendingKeys.map(
        (key) =>
          (requirements[key]?.length ?? 0) > 0 && (
            <section key={key} className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h3 className="font-semibold text-amber-900">
                {t('overview.requirementsTitle', { role: t(`roles.${key}`) })}
              </h3>
              <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
                {requirements[key].map((d) => (
                  <li key={d.documentType}>
                    {d.titleI18n[locale] ?? d.titleI18n.en}
                    {!d.isRequired && ` (${t('overview.optional')})`}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-700">{t('overview.uploadComingSoon')}</p>
            </section>
          ),
      )}
    </div>
  );
}
