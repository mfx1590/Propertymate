import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { API_BASE, fmtGbp, type RegionInfo } from '../../../lib/listings';
import { Link } from '../../../i18n/routing';

interface MonthRow {
  month: string;
  saleCount: number;
  rentCount: number;
  saleMedianGbp: number | null;
  rentMedianGbp: number | null;
  salePerM2Gbp: number | null;
  newListings: number;
  priceDrops: number;
  medianDropPct: number | null;
  views: number;
}

/**
 * Monthly market insights (§6.1, §10.2 Phase 3).
 *
 * Server-rendered on demand — the step-16 lesson: prerendering here would make
 * the build depend on a running API. The page is explicit that every figure is
 * asking prices and traffic on this platform, not "the TRNC market"; the
 * honesty is the product, on a coastline full of invented statistics.
 */
export const revalidate = 600;

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'marketInsights' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

async function fetchJson<T>(path: string, revalidateSecs: number): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { next: { revalidate: revalidateSecs } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function InsightsPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { region?: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations('marketInsights');
  const regions = (await fetchJson<RegionInfo[]>('/regions', 3600)) ?? [];
  const slug = regions.some((r) => r.slug === searchParams.region)
    ? (searchParams.region as string)
    : 'kyrenia';
  const series = await fetchJson<{ months: MonthRow[] }>(`/insights/regions/${slug}`, 600);
  const months = series?.months ?? [];
  const latest = months[months.length - 1] ?? null;
  const regionName = (s: string) =>
    regions.find((r) => r.slug === s)?.nameI18n[locale] ??
    regions.find((r) => r.slug === s)?.nameI18n.en ??
    s;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t('title', { region: regionName(slug) })}</h1>
      <p className="mt-2 max-w-2xl text-gray-600">{t('blurb')}</p>

      {/* Plain GET form — works with no JavaScript, and every region's view
          has its own shareable URL (the lawyers directory pattern). */}
      <form method="get" className="mt-5 flex flex-wrap gap-2">
        <select name="region" defaultValue={slug} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          {regions.map((r) => (
            <option key={r.slug} value={r.slug}>{r.nameI18n[locale] ?? r.nameI18n.en}</option>
          ))}
        </select>
        <button className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white">
          {t('show')}
        </button>
        <Link
          href="/valuation"
          className="ms-auto self-center rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-600"
        >
          {t('valuationCta')}
        </Link>
      </form>

      {latest ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">{t('tiles.saleMedian')}</p>
              <p className="mt-1 text-xl font-bold text-brand-600">
                {latest.saleMedianGbp != null ? fmtGbp(latest.saleMedianGbp) : '—'}
              </p>
              {latest.salePerM2Gbp != null && (
                <p className="text-xs text-gray-400">{t('tiles.perM2', { amount: fmtGbp(latest.salePerM2Gbp) })}</p>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">{t('tiles.rentMedian')}</p>
              <p className="mt-1 text-xl font-bold text-brand-600">
                {latest.rentMedianGbp != null ? fmtGbp(latest.rentMedianGbp) : '—'}
              </p>
              <p className="text-xs text-gray-400">{t('tiles.perMonth')}</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">{t('tiles.live')}</p>
              <p className="mt-1 text-xl font-bold">{latest.saleCount + latest.rentCount}</p>
              <p className="text-xs text-gray-400">
                {t('tiles.liveSplit', { sale: latest.saleCount, rent: latest.rentCount })}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs uppercase tracking-wide text-gray-400">{t('tiles.thisMonth')}</p>
              <p className="mt-1 text-xl font-bold">{latest.newListings}</p>
              <p className="text-xs text-gray-400">
                {latest.priceDrops > 0
                  ? t('tiles.drops', { count: latest.priceDrops, pct: latest.medianDropPct ?? 0 })
                  : t('tiles.noDrops')}
              </p>
            </div>
          </div>

          <h2 className="mt-10 text-lg font-semibold">{t('history.title')}</h2>
          {months.length < 2 && <p className="mt-1 text-sm text-gray-500">{t('history.building')}</p>}
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3">{t('history.month')}</th>
                  <th className="px-4 py-3">{t('history.saleMedian')}</th>
                  <th className="px-4 py-3">{t('history.perM2')}</th>
                  <th className="px-4 py-3">{t('history.rentMedian')}</th>
                  <th className="px-4 py-3">{t('history.newListings')}</th>
                  <th className="px-4 py-3">{t('history.priceDrops')}</th>
                  <th className="px-4 py-3">{t('history.views')}</th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr key={m.month} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{m.month}</td>
                    <td className="px-4 py-2.5">{m.saleMedianGbp != null ? fmtGbp(m.saleMedianGbp) : '—'}</td>
                    <td className="px-4 py-2.5">{m.salePerM2Gbp != null ? fmtGbp(m.salePerM2Gbp) : '—'}</td>
                    <td className="px-4 py-2.5">{m.rentMedianGbp != null ? fmtGbp(m.rentMedianGbp) : '—'}</td>
                    <td className="px-4 py-2.5">{m.newListings}</td>
                    <td className="px-4 py-2.5">
                      {m.priceDrops}
                      {m.medianDropPct != null && (
                        <span className="text-xs text-gray-400"> (−{m.medianDropPct}%)</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{m.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50/60 p-8">
          <p className="font-semibold text-gray-800">{t('empty.title')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('empty.body')}</p>
        </div>
      )}

      {/* What these numbers are and are not — the sentence that keeps this
          page honest, so it sits under everything, always. */}
      <p className="mt-8 rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-sm text-gray-500">
        {t('disclaimer')}
      </p>
    </main>
  );
}
