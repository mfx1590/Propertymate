'use client';

import { useTranslations } from 'next-intl';

/** Catch-all for dashboard sections that arrive in later build steps (listings, leads, admin…). */
export default function ComingSoonPage() {
  const t = useTranslations('dashboard');
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <p className="text-4xl">🏗️</p>
      <h1 className="mt-3 text-xl font-semibold text-gray-700">{t('comingSoon.title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('comingSoon.body')}</p>
    </div>
  );
}
