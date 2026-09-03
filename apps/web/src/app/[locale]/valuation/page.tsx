'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { API_BASE, fmtGbp, type RegionInfo } from '../../../lib/listings';
import { Link } from '../../../i18n/routing';
import { Money } from '../../../components/Money';
import { CurrencySwitcher } from '../../../components/CurrencySwitcher';

interface ValuationResult {
  available: boolean;
  comparableCount: number;
  minComparables?: number;
  perM2MedianGbp?: number;
  estimateGbp?: number;
  lowGbp?: number;
  highGbp?: number;
}

/**
 * Valuation estimate v1 (§10.2 Phase 3).
 *
 * The page's framing carries the honesty the number cannot: the estimate is a
 * median of current asking prices for similar listings on this platform — not
 * a professional valuation, not a sold price, and it refuses outright when
 * there are too few comparables to mean anything.
 */
export default function ValuationPage() {
  const t = useTranslations('valuation');
  const locale = useLocale();
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [form, setForm] = useState({ kind: 'resale', region: '', areaM2: '', bedrooms: '' });
  const [result, setResult] = useState<ValuationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${API_BASE}/regions`)
      .then((r) => r.json())
      .then((d) => {
        setRegions(d);
        setForm((f) => ({ ...f, region: f.region || d[0]?.slug || '' }));
      })
      .catch(() => setRegions([]));
  }, []);

  const estimate = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams({ kind: form.kind, region: form.region, areaM2: form.areaM2 });
      if (form.bedrooms) qs.set('bedrooms', form.bedrooms);
      const res = await fetch(`${API_BASE}/insights/valuation?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(Array.isArray(data.message) ? data.message.join('; ') : data.message);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selCls = 'rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="mt-2 max-w-2xl text-gray-600">{t('blurb')}</p>

      <div className="mt-6 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 p-4">
        <label className="block">
          <span className="text-xs text-gray-500">{t('form.kind')}</span>
          <select className={`${selCls} mt-1 block`} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
            <option value="resale">{t('form.kinds.resale')}</option>
            <option value="rental">{t('form.kinds.rental')}</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">{t('form.region')}</span>
          <select className={`${selCls} mt-1 block`} value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}>
            {regions.map((r) => (
              <option key={r.slug} value={r.slug}>{r.nameI18n[locale] ?? r.nameI18n.en}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">{t('form.area')}</span>
          <input
            type="number" min={10} max={5000}
            className={`${selCls} mt-1 block w-28`}
            value={form.areaM2}
            onChange={(e) => setForm((f) => ({ ...f, areaM2: e.target.value }))}
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">{t('form.bedrooms')}</span>
          <input
            type="number" min={0} max={20}
            className={`${selCls} mt-1 block w-24`}
            placeholder={t('form.optional')}
            value={form.bedrooms}
            onChange={(e) => setForm((f) => ({ ...f, bedrooms: e.target.value }))}
          />
        </label>
        <button
          onClick={estimate}
          disabled={busy || !form.areaM2 || !form.region}
          className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? '…' : t('form.estimate')}
        </button>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && !result.available && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50/60 p-6">
          <p className="font-semibold text-gray-800">{t('few.title')}</p>
          {/* Says why there is no number rather than inventing one — an
              estimate from {count} listings would be a guess in a suit. */}
          <p className="mt-1 text-sm text-gray-500">
            {t('few.body', { count: result.comparableCount, min: result.minComparables ?? 5 })}
          </p>
        </div>
      )}

      {result?.available && (
        <div className="mt-6 rounded-xl border border-brand-500/40 bg-brand-50/40 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {t('result.label', { count: result.comparableCount })}
            </p>
            <CurrencySwitcher />
          </div>
          <p className="mt-2 text-3xl font-bold text-brand-600">
            <Money gbp={result.estimateGbp as number} />
            {form.kind === 'rental' && <span className="text-base font-normal text-gray-500"> {t('result.perMonth')}</span>}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {t('result.range')} <Money gbp={result.lowGbp as number} /> – <Money gbp={result.highGbp as number} />
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {t('result.perM2', { amount: fmtGbp(result.perM2MedianGbp as number) })}
          </p>
          <p className="mt-4 border-t border-brand-500/20 pt-3 text-sm text-gray-500">{t('result.honest')}</p>
        </div>
      )}

      <p className="mt-8 text-sm text-gray-500">
        {t('sellHint')}{' '}
        <Link href="/insights" className="text-brand-600 underline">
          {t('insightsLink')}
        </Link>
      </p>

      <p className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-sm text-gray-500">
        {t('disclaimer')}
      </p>
    </main>
  );
}
