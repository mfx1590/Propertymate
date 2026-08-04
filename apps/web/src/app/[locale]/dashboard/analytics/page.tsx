'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet } from '../../../../lib/api';
import {
  RANKING_FACTOR_ORDER,
  formatFactorValue,
  type MyAnalytics,
} from '../../../../lib/analytics';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

/** One funnel step with the conversion rate that carried into it. */
function FunnelStep({ label, count, rate }: { label: string; count: number; rate?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-sm text-gray-500">{label}</div>
      <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
        <div
          className="h-full bg-brand-600"
          style={{ width: `${Math.min(100, rate ?? 100)}%` }}
          aria-hidden
        />
      </div>
      <div className="w-24 shrink-0 text-end text-sm">
        <span className="font-semibold">{count}</span>
        {rate !== undefined && <span className="ms-1 text-xs text-gray-400">{rate}%</span>}
      </div>
    </div>
  );
}

/**
 * Performance dashboard for professional roles (Plan §6.7, §13.1).
 * Blocks render from what the API returns, not from role checks — a user who is
 * both an agent and a developer sees both sections.
 */
export default function AnalyticsPage() {
  const t = useTranslations('analytics');
  const locale = useLocale();
  const [data, setData] = useState<MyAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<MyAnalytics>('/analytics/me')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-gray-400">…</p>;

  const { funnel, reputation } = data;
  const nf = new Intl.NumberFormat(locale);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {data.scope.isOrg ? t('subtitleOrg') : t('subtitle')}
      </p>

      {/* headline numbers */}
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label={t('views')} value={nf.format(funnel.views)} hint={t('lastDays', { days: data.scope.windowDays, n: funnel.viewsRecent })} />
        <Stat label={t('leads')} value={nf.format(funnel.inquiries)} />
        <Stat label={t('salesClosed')} value={data.deals.salesClosed} />
        <Stat label={t('rentalsClosed')} value={data.deals.rentalsClosed} />
      </div>

      {/* funnel */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t('funnel')}</h2>
        <p className="mt-1 text-xs text-gray-400">{t('funnelHint')}</p>
        <div className="mt-4 space-y-2">
          <FunnelStep label={t('views')} count={funnel.views} />
          <FunnelStep label={t('leads')} count={funnel.inquiries} rate={funnel.inquiryRate} />
          <FunnelStep label={t('viewings')} count={funnel.viewings} rate={funnel.viewingRate} />
          <FunnelStep label={t('offers')} count={funnel.offers} rate={funnel.offerRate} />
          <FunnelStep label={t('dealsClosed')} count={funnel.dealsCompleted} rate={funnel.closeRate} />
        </div>
      </section>

      {/* listing status board */}
      {Object.keys(data.listings).length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t('listings')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(data.listings).map(([status, count]) => (
              <span key={status} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                {t(`status.${status}`)} <span className="font-semibold">{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ranking score — a pro must be able to see what they are ranked on */}
      {reputation && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t('ranking')}</h2>
          <p className="mt-1 text-xs text-gray-400">{t('rankingHint')}</p>
          <div className="mt-3 rounded-xl border border-gray-200 p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{reputation.score}</span>
              <span className="text-sm text-gray-400">/ 100</span>
              {reputation.computedAt && (
                <span className="ms-auto text-xs text-gray-400">
                  {t('computedAt')} {new Date(reputation.computedAt).toLocaleDateString(locale)}
                </span>
              )}
            </div>
            <ul className="mt-4 space-y-2">
              {RANKING_FACTOR_ORDER.map((key) => {
                const f = reputation.factors[key];
                return (
                  <li key={key} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-sm text-gray-500">{t(`factor.${key}`)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded bg-gray-100">
                      <span
                        className="block h-full bg-emerald-500"
                        style={{ width: `${Math.round(f.score * 100)}%` }}
                        aria-hidden
                      />
                    </span>
                    <span className="w-16 shrink-0 text-end text-sm">
                      {formatFactorValue(key, f.value)}
                    </span>
                    <span className="w-16 shrink-0 text-end text-xs text-gray-400">
                      {(f.score * f.weight).toFixed(1)} / {f.weight}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* agency org rollup (§13.1) */}
      {data.members && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t('team')}</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-start text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-2 text-start font-medium">{t('member')}</th>
                  <th className="py-2 text-end font-medium">{t('score')}</th>
                  <th className="py-2 text-end font-medium">{t('listings')}</th>
                  <th className="py-2 text-end font-medium">{t('salesClosed')}</th>
                  <th className="py-2 text-end font-medium">{t('rentalsClosed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.userId} className="border-t border-gray-100">
                    <td className="py-2">{m.phone ?? m.userId}</td>
                    <td className="py-2 text-end">{m.rankingScore ?? '—'}</td>
                    <td className="py-2 text-end">{m.listings}</td>
                    <td className="py-2 text-end">{m.salesClosed}</td>
                    <td className="py-2 text-end">{m.rentalsClosed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* developer projects (§6.3) */}
      {data.projects && data.projects.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t('projects')}</h2>
          <ul className="mt-3 space-y-3">
            {data.projects.map((p) => (
              <li key={p.projectId} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-gray-400">{p.regionSlug}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded bg-gray-100">
                  <span
                    className="block h-full bg-brand-600"
                    style={{ width: `${p.absorptionRate}%` }}
                    aria-hidden
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-500">
                  <span>{t('absorption')} <span className="font-semibold text-gray-900">{p.absorptionRate}%</span></span>
                  <span>{t('unitsSold')} <span className="font-semibold text-gray-900">{p.units.sold}/{p.units.total}</span></span>
                  <span>{t('reserved')} <span className="font-semibold text-gray-900">{p.units.reserved}</span></span>
                  <span>{t('pricePerM2')} <span className="font-semibold text-gray-900">{p.avgPricePerM2 ? nf.format(p.avgPricePerM2) : '—'}</span></span>
                  <span>{t('leads')} <span className="font-semibold text-gray-900">{p.leads}</span></span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* mine vs market (§13.1b) */}
      {data.comparison && data.comparison.byRegion.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t('comparison')}</h2>
          <p className="mt-1 text-xs text-gray-400">{t('comparisonHint')}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="py-2 text-start font-medium">{t('region')}</th>
                  <th className="py-2 text-end font-medium">{t('myPricePerM2')}</th>
                  <th className="py-2 text-end font-medium">{t('marketPricePerM2')}</th>
                  <th className="py-2 text-end font-medium">{t('myAbsorption')}</th>
                  <th className="py-2 text-end font-medium">{t('marketAbsorption')}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...data.comparison.byRegion.map((r) => ({ label: r.regionSlug, ...r })),
                  { label: t('allRegions'), ...data.comparison.overall },
                ].map((row) => (
                  <tr key={row.label} className="border-t border-gray-100">
                    <td className="py-2">{row.label}</td>
                    <td className="py-2 text-end">{row.mine.medianPricePerM2 ? nf.format(Math.round(row.mine.medianPricePerM2)) : '—'}</td>
                    <td className="py-2 text-end text-gray-500">{row.market.medianPricePerM2 ? nf.format(Math.round(row.market.medianPricePerM2)) : '—'}</td>
                    <td className="py-2 text-end">{row.mine.avgAbsorption ?? '—'}%</td>
                    <td className="py-2 text-end text-gray-500">{row.market.avgAbsorption ?? '—'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
