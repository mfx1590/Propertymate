'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../lib/api';
import { Link } from '../../../../i18n/routing';

interface Engagement {
  id: string;
  dealId: string;
  status: 'requested' | 'quoted' | 'declined' | 'accepted' | 'withdrawn';
  stageKey: string;
  scope: string | null;
  quoteAmount: number | null;
  quoteCurrency: string | null;
  quoteNote: string | null;
  createdAt: string;
  deal: { id: string; kind: string; currentStageKey: string; status: string; title: string };
}

const CURRENCIES = ['GBP', 'EUR', 'USD', 'TRY'];

/**
 * The only stages a lawyer can be engaged at, per the seeded pipeline config.
 * Bounded on purpose: `t()` on an unknown key renders the key itself, and a
 * raw `permit_process` in a professional's inbox is the step-10 bug again.
 */
const ENGAGEABLE_STAGES = ['legal_check', 'contract_signing', 'permit_process'];

/**
 * The lawyer's own request inbox (Plan §10.2).
 *
 * Ordered newest-first and never filtered by default: an unanswered request is
 * the thing this screen exists to stop happening, so it must not be one tab
 * away behind a status filter.
 */
export default function LegalInboxPage() {
  const t = useTranslations('legal');
  const locale = useLocale();
  const [rows, setRows] = useState<Engagement[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Engagement[]>('/legal/engagements'));
      setState('ready');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const money = (e: Engagement) =>
    e.quoteAmount != null && e.quoteCurrency
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: e.quoteCurrency,
          maximumFractionDigits: 0,
        }).format(e.quoteAmount)
      : null;

  const statusCls: Record<Engagement['status'], string> = {
    requested: 'bg-amber-50 text-amber-700',
    quoted: 'bg-blue-50 text-blue-700',
    accepted: 'bg-emerald-50 text-emerald-700',
    declined: 'bg-gray-100 text-gray-500',
    withdrawn: 'bg-gray-100 text-gray-500',
  };

  if (state === 'loading') return <p className="text-gray-400">…</p>;

  const waiting = rows.filter((r) => r.status === 'requested').length;

  return (
    <div>
      <h1 className="text-2xl font-bold">{t('inbox.title')}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {waiting > 0 ? t('inbox.waiting', { count: waiting }) : t('inbox.allAnswered')}
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50/60 p-8">
          <p className="font-semibold text-gray-800">{t('inbox.emptyTitle')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('inbox.emptyBody')}</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((e) => (
            <li key={e.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{e.deal.title}</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {t(`kind.${e.deal.kind}`)}
                    {ENGAGEABLE_STAGES.includes(e.stageKey) && ` · ${t(`stages.${e.stageKey}`)}`}
                  </p>
                  <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCls[e.status]}`}>
                    {t(`status.${e.status}`)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {money(e) && <span className="text-lg font-bold text-brand-600">{money(e)}</span>}
                  {e.status === 'accepted' && (
                    <Link
                      href={`/dashboard/deals/${e.dealId}`}
                      className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white"
                    >
                      {t('inbox.openRoom')}
                    </Link>
                  )}
                  {(e.status === 'requested' || e.status === 'quoted') && (
                    <>
                      <button
                        onClick={() => {
                          setQuoting(quoting === e.id ? null : e.id);
                          setAmount(e.quoteAmount != null ? String(e.quoteAmount) : '');
                          setCurrency(e.quoteCurrency ?? 'GBP');
                          setNote(e.quoteNote ?? '');
                        }}
                        className="rounded-lg border border-brand-600 px-4 py-1.5 text-sm font-medium text-brand-600"
                      >
                        {e.status === 'quoted' ? t('inbox.requote') : t('inbox.quote')}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => act(() => apiPost(`/legal/engagements/${e.id}/decline`, {}))}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 disabled:opacity-50"
                      >
                        {t('inbox.decline')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {e.scope && (
                <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                  <span className="font-medium text-gray-500">{t('inbox.scope')}: </span>
                  {e.scope}
                </p>
              )}

              {quoting === e.id && (
                <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                  <label className="block">
                    <span className="text-xs text-gray-500">{t('inbox.amount')}</span>
                    <input
                      type="number"
                      min={1}
                      className="mt-1 w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={amount}
                      onChange={(ev) => setAmount(ev.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-gray-500">{t('inbox.currency')}</span>
                    <select
                      className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      value={currency}
                      onChange={(ev) => setCurrency(ev.target.value)}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block flex-1">
                    <span className="text-xs text-gray-500">{t('inbox.note')}</span>
                    <input
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder={t('inbox.notePlaceholder')}
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || !amount}
                    onClick={() =>
                      act(async () => {
                        await apiPost(`/legal/engagements/${e.id}/quote`, {
                          amount: Number(amount),
                          currency,
                          note: note || undefined,
                        });
                        setQuoting(null);
                      })
                    }
                    className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('inbox.send')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* The fee is between the lawyer and the client — the platform records it
          and takes nothing from it. Said here so nobody has to guess. */}
      <p className="mt-6 text-sm text-gray-400">{t('inbox.feeNote')}</p>
    </div>
  );
}
