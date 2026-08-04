'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet } from '../../../../../lib/api';

interface PlatformAnalytics {
  windowDays: number;
  supplyByRegion: Record<string, Record<string, number>>;
  listingsByStatus: Record<string, number>;
  funnel: {
    views: number;
    inquiries: number;
    viewings: number;
    offers: number;
    deals: number;
    dealsCompleted: number;
  };
  verification: {
    decided: number;
    avgTurnaroundHours: number | null;
    withinSlaPct: number | null;
    approvalRatePct: number | null;
  };
}

/** Platform-wide analytics for admins (Plan §6.7). */
export default function PlatformAnalyticsPage() {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const [data, setData] = useState<PlatformAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PlatformAnalytics>('/analytics/admin/overview')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-gray-400">…</p>;

  const nf = new Intl.NumberFormat(locale);
  const statuses = [...new Set(Object.values(data.supplyByRegion).flatMap((r) => Object.keys(r)))];

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {t('admin.subtitle', { days: data.windowDays })}
      </p>

      {/* verification SLA (§4 admin metrics) */}
      <section className="mt-6">
        <h2 className="text-lg font-semibold">{t('admin.verification')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {[
            { label: t('admin.decided'), value: nf.format(data.verification.decided) },
            {
              label: t('admin.turnaround'),
              value: data.verification.avgTurnaroundHours !== null ? `${data.verification.avgTurnaroundHours}h` : '—',
            },
            {
              label: t('admin.withinSla'),
              value: data.verification.withinSlaPct !== null ? `${data.verification.withinSlaPct}%` : '—',
            },
            {
              label: t('admin.approvalRate'),
              value: data.verification.approvalRatePct !== null ? `${data.verification.approvalRatePct}%` : '—',
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">{s.label}</p>
              <p className="mt-1 text-2xl font-bold">{s.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Volume per step over the window — deliberately not called a funnel:
          these are independent 30-day counts, not one cohort flowing through,
          so "closed" can exceed "offers" when a deal opened before the window. */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t('admin.marketFunnel')}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['views', data.funnel.views],
              ['leads', data.funnel.inquiries],
              ['viewings', data.funnel.viewings],
              ['offers', data.funnel.offers],
              ['dealsClosed', data.funnel.dealsCompleted],
            ] as const
          ).map(([key, value]) => (
            <span key={key} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
              {t(key)} <span className="font-semibold">{nf.format(value)}</span>
            </span>
          ))}
        </div>
      </section>

      {/* supply by region — the §6.7 supply/demand view */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t('admin.supply')}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-2 text-start font-medium">{t('region')}</th>
                {statuses.map((s) => (
                  <th key={s} className="py-2 text-end font-medium">
                    {t(`status.${s}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.supplyByRegion).map(([region, counts]) => (
                <tr key={region} className="border-t border-gray-100">
                  <td className="py-2">{region}</td>
                  {statuses.map((s) => (
                    <td key={s} className="py-2 text-end">
                      {counts[s] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
