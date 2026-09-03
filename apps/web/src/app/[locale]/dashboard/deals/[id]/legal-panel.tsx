'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../../lib/api';
import { API_BASE, type RegionInfo } from '../../../../../lib/listings';

interface Engagement {
  id: string;
  lawyerUserId: string;
  lawyerName: string;
  requestedByUserId: string;
  stageKey: string;
  status: 'requested' | 'quoted' | 'declined' | 'accepted' | 'withdrawn';
  scope: string | null;
  quoteAmount: number | null;
  quoteCurrency: string | null;
  quoteNote: string | null;
  createdAt: string;
}

interface DirectoryLawyer {
  userId: string;
  name: string;
  bio: string | null;
  regions: string[];
  languages: string[];
  feeModel: string | null;
  feeNote: string | null;
  engagementCount: number;
}

const OPEN: Engagement['status'][] = ['requested', 'quoted'];

/**
 * Engaging a lawyer from inside the deal room (Plan §10.2).
 *
 * The panel appears only where the pipeline says a lawyer may attach, because
 * the API refuses everywhere else — showing a button that always 400s is the
 * pattern the step-7 contract panel deliberately avoided, and this follows it.
 */
export function LegalPanel({
  dealId,
  currentStageLabel,
  injectableHere,
  onChange,
}: {
  dealId: string;
  /** Already localised by the caller — a raw stage key must never reach a user. */
  currentStageLabel: string;
  /** Does the CURRENT stage declare `lawyer` injectable? */
  injectableHere: boolean;
  onChange: () => void;
}) {
  const t = useTranslations('legal');
  const locale = useLocale();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [directory, setDirectory] = useState<DirectoryLawyer[]>([]);
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [scope, setScope] = useState('');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEngagements(await apiGet<Engagement[]>(`/deals/${dealId}/legal/engagements`));
    } catch {
      setEngagements([]);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Both fetched only when the picker opens, and only once. Regions come along
  // because a lawyer's coverage is stored as slugs — printing `kyrenia` at a
  // Russian reader is the raw-key defect step 16 caught on region titles.
  useEffect(() => {
    if (!picking || directory.length > 0) return;
    void fetch(`${API_BASE}/lawyers/directory`)
      .then((r) => r.json())
      .then((d) => setDirectory(Array.isArray(d) ? d : []))
      .catch(() => setDirectory([]));
    void fetch(`${API_BASE}/regions`)
      .then((r) => r.json())
      .then((d) => setRegions(Array.isArray(d) ? d : []))
      .catch(() => setRegions([]));
  }, [picking, directory.length]);

  const regionName = (slug: string) =>
    regions.find((r) => r.slug === slug)?.nameI18n[locale] ??
    regions.find((r) => r.slug === slug)?.nameI18n.en ??
    slug;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const accepted = engagements.find((e) => e.status === 'accepted');
  const open = engagements.filter((e) => OPEN.includes(e.status));
  const closed = engagements.filter((e) => !OPEN.includes(e.status) && e.status !== 'accepted');
  const money = (e: Engagement) =>
    e.quoteAmount != null && e.quoteCurrency
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: e.quoteCurrency,
          maximumFractionDigits: 0,
        }).format(e.quoteAmount)
      : null;

  const statusCls: Record<Engagement['status'], string> = {
    requested: 'bg-gray-100 text-gray-600',
    quoted: 'bg-amber-50 text-amber-700',
    accepted: 'bg-emerald-50 text-emerald-700',
    declined: 'bg-gray-100 text-gray-500',
    withdrawn: 'bg-gray-100 text-gray-500',
  };

  return (
    <section className="mt-6 rounded-xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('panel.title')}</h2>
        {!accepted && injectableHere && !picking && (
          <button
            onClick={() => setPicking(true)}
            className="rounded-lg border border-brand-600 px-4 py-1.5 text-sm font-medium text-brand-600"
          >
            {open.length > 0 ? t('panel.askMore') : t('panel.ask')}
          </button>
        )}
      </div>

      <p className="mt-1 text-sm text-gray-500">{t('panel.blurb')}</p>

      {/* Says why there is no button, rather than leaving a blank panel. */}
      {!accepted && !injectableHere && (
        <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-500">
          {t('panel.notAtThisStage', { stage: currentStageLabel })}
        </p>
      )}

      {accepted && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="font-medium text-emerald-800">
            {t('panel.acting', { name: accepted.lawyerName })}
          </p>
          {money(accepted) && (
            <p className="mt-0.5 text-sm text-emerald-700">
              {t('panel.agreedFee', { amount: money(accepted) as string })}
            </p>
          )}
          {accepted.quoteNote && <p className="mt-2 text-sm text-gray-600">{accepted.quoteNote}</p>}
        </div>
      )}

      {open.length > 0 && (
        <ul className="mt-4 space-y-2">
          {open.map((e) => (
            <li key={e.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{e.lawyerName}</p>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCls[e.status]}`}>
                    {t(`status.${e.status}`)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {money(e) && <span className="text-lg font-bold text-brand-600">{money(e)}</span>}
                  {e.status === 'quoted' && !accepted && (
                    <button
                      disabled={busy}
                      onClick={() => act(() => apiPost(`/legal/engagements/${e.id}/accept`, {}))}
                      className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {t('panel.accept')}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => act(() => apiPost(`/legal/engagements/${e.id}/withdraw`, {}))}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-50"
                  >
                    {t('panel.withdraw')}
                  </button>
                </div>
              </div>
              {e.quoteNote && <p className="mt-2 text-sm text-gray-600">{e.quoteNote}</p>}
            </li>
          ))}
        </ul>
      )}

      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-500">
            {t('panel.closedCount', { count: closed.length })}
          </summary>
          <ul className="mt-2 space-y-1">
            {closed.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm text-gray-500">
                <span>{e.lawyerName}</span>
                <span>{t(`status.${e.status}`)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {picking && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
          <p className="text-sm font-medium">{t('panel.pickTitle')}</p>
          <textarea
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={2}
            placeholder={t('panel.scopePlaceholder')}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
          <ul className="mt-3 space-y-2">
            {directory
              .filter((l) => !engagements.some((e) => e.lawyerUserId === l.userId && OPEN.includes(e.status)))
              .map((l) => (
                <li key={l.userId}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.includes(l.userId)}
                      onChange={() =>
                        setPicked((p) =>
                          p.includes(l.userId) ? p.filter((x) => x !== l.userId) : [...p, l.userId],
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{l.name}</span>
                      {l.feeNote && <span className="block text-sm text-gray-500">{l.feeNote}</span>}
                      <span className="block text-xs text-gray-400">
                        {l.regions.length ? l.regions.map(regionName).join(', ') : t('allRegions')}
                        {l.languages.length > 0 &&
                          ` · ${l.languages.map((x) => t(`languages.${x}`)).join(', ')}`}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
          </ul>
          {directory.length === 0 && <p className="mt-2 text-sm text-gray-400">{t('panel.noneYet')}</p>}
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy || picked.length === 0}
              onClick={() =>
                act(async () => {
                  await apiPost(`/deals/${dealId}/legal/requests`, {
                    lawyerUserIds: picked,
                    scope: scope || undefined,
                  });
                  setPicked([]);
                  setScope('');
                  setPicking(false);
                })
              }
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('panel.sendRequests', { count: picked.length })}
            </button>
            <button
              onClick={() => { setPicking(false); setPicked([]); }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600"
            >
              {t('panel.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
