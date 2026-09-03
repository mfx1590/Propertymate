'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError, apiGet } from '../../../../../lib/api';
import { downloadAuthenticated } from '../../../../../lib/download';

const DATASETS = ['users', 'listings', 'deals', 'subscriptions', 'payments', 'disputes', 'audit'] as const;
type Dataset = (typeof DATASETS)[number];

/**
 * Admin data exports (§6.7, §10.2 Phase 3 — step 27).
 *
 * Every download is itself written to the audit log with the row count, and
 * the page says so: an admin should know that pulling a file is an event, not
 * a private act.
 */
export default function ExportsPage() {
  const t = useTranslations('adminExports');
  const [counts, setCounts] = useState<Record<Dataset, number> | null>(null);
  const [busy, setBusy] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Record<Dataset, number>>('/admin/exports')
      .then(setCounts)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const download = async (ds: Dataset) => {
    setBusy(ds);
    setError(null);
    try {
      await downloadAuthenticated(`/admin/exports/${ds}`, `propverify-${ds}.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {DATASETS.map((ds) => (
          <li key={ds} className="flex items-center justify-between rounded-xl border border-gray-200 p-4">
            <div>
              <p className="font-semibold">{t(`datasets.${ds}`)}</p>
              <p className="text-xs text-gray-400">
                {counts ? t('rows', { count: counts[ds] }) : '…'}
              </p>
            </div>
            <button
              disabled={busy !== null}
              onClick={() => void download(ds)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy === ds ? '…' : t('download')}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-sm text-gray-500">
        {t('note')}
      </p>
    </div>
  );
}
