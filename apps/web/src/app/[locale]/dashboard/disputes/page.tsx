'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../lib/api';

interface DisputeRow {
  id: string;
  dealId: string;
  reason: string;
  status: 'open' | 'investigating' | 'resolved_upheld' | 'resolved_dismissed' | 'withdrawn';
  resolutionNote: string | null;
  createdAt: string;
  iOpened: boolean;
  dealTitle: string;
  statementCount: number;
}

interface DisputeDetail extends Omit<DisputeRow, 'statementCount'> {
  statements: { id: string; mine: boolean; byAdmin: boolean; body: string; createdAt: string }[];
}

const OPEN = ['open', 'investigating'];

/**
 * A party's own dispute cases (Plan §6.7 full workflow, step 26).
 *
 * Until this page existed a person named in a dispute had no surface at all —
 * the case about them lived only in the admin console. Here they read it,
 * give their side, and see the decision with its note; the opener can also
 * withdraw a case that life resolved, while it is still merely `open`.
 */
export default function DisputesPage() {
  const t = useTranslations('disputes');
  const locale = useLocale();
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [statement, setStatement] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<DisputeRow[]>('/users/me/disputes'));
      setState('ready');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCase = async (id: string) => {
    setError(null);
    try {
      setDetail(await apiGet<DisputeDetail>(`/disputes/${id}`));
      setStatement('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const act = async (fn: () => Promise<unknown>, reloadDetail = true) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      if (reloadDetail && detail) await openCase(detail.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const statusCls: Record<DisputeRow['status'], string> = {
    open: 'bg-amber-50 text-amber-700',
    investigating: 'bg-blue-50 text-blue-700',
    resolved_upheld: 'bg-red-50 text-red-700',
    resolved_dismissed: 'bg-gray-100 text-gray-500',
    withdrawn: 'bg-gray-100 text-gray-500',
  };

  if (state === 'loading') return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50/60 p-8">
          <p className="font-semibold text-gray-800">{t('emptyTitle')}</p>
          {/* Says where a dispute is opened from, since it is not from here. */}
          <p className="mt-1 text-sm text-gray-500">{t('emptyBody')}</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => void openCase(d.id)}
                className={`w-full rounded-xl border p-3 text-left text-sm transition hover:border-brand-500 ${
                  detail?.id === d.id ? 'border-brand-600' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{d.dealTitle}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCls[d.status]}`}>
                    {t(`status.${d.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {d.iOpened ? t('roleOpener') : t('roleRespondent')} ·{' '}
                  {new Date(d.createdAt).toLocaleDateString(locale)} ·{' '}
                  {t('statementCount', { count: d.statementCount })}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detail && (
        <section className="mt-6 rounded-xl border-2 border-brand-600 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{detail.dealTitle}</h2>
            <button className="text-sm text-gray-500" onClick={() => setDetail(null)}>
              {t('close')}
            </button>
          </div>

          <p className="mt-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <span className="font-medium text-gray-500">{t('reasonLabel')}: </span>
            {detail.reason}
          </p>

          {detail.status === 'investigating' && (
            <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{t('investigatingNote')}</p>
          )}
          {detail.resolutionNote && (
            <p className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
              <span className="font-medium">{t('resolutionLabel')}: </span>
              {detail.resolutionNote}
            </p>
          )}

          <h3 className="mt-4 text-sm font-semibold">{t('statements.title')}</h3>
          {detail.statements.length === 0 && <p className="mt-1 text-xs text-gray-400">{t('statements.none')}</p>}
          <ul className="mt-1 space-y-1 text-sm">
            {detail.statements.map((s) => (
              <li key={s.id} className={`rounded-lg px-3 py-2 ${s.byAdmin ? 'bg-brand-50' : s.mine ? 'bg-emerald-50/60' : 'bg-gray-50'}`}>
                <span className="text-xs text-gray-400">
                  {s.byAdmin ? t('statements.admin') : s.mine ? t('statements.you') : t('statements.otherSide')} ·{' '}
                  {new Date(s.createdAt).toLocaleString(locale)}
                </span>
                <p>{s.body}</p>
              </li>
            ))}
          </ul>

          {OPEN.includes(detail.status) ? (
            <div className="mt-3 flex gap-2">
              <textarea
                rows={2}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder={t('statements.placeholder')}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
              />
              <button
                disabled={busy || !statement.trim()}
                onClick={() =>
                  act(() => apiPost(`/disputes/${detail.id}/statements`, { body: statement }))
                }
                className="self-end rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {t('statements.send')}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-400">{t('statements.closed')}</p>
          )}

          {/* Withdrawal exists only while merely `open` — under investigation
              the case is the platform's, and the button says so by absence. */}
          {detail.iOpened && detail.status === 'open' && (
            <button
              disabled={busy}
              onClick={() => act(() => apiPost(`/disputes/${detail.id}/withdraw`, {}))}
              className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-50"
            >
              {t('withdraw')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
