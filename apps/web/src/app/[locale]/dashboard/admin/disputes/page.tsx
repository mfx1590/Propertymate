'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../../lib/api';

interface DisputeRow {
  id: string;
  dealId: string;
  reason: string;
  status: string;
  resolutionNote: string | null;
  createdAt: string;
  openedByUser: { id: string; phone: string | null; email: string | null } | null;
  againstUser: { id: string; phone: string | null; email: string | null } | null;
}

interface Bundle extends DisputeRow {
  statements: { id: string; authorUserId: string; byAdmin: boolean; body: string; createdAt: string }[];
  deal: {
    id: string; kind: string; status: string; currentStageKey: string;
    title: string | null; priceAgreed: number | null; currency: string | null;
    parties: { userId: string; partyRole: string }[];
  } | null;
  evidence: {
    events: { id: string; actorId: string | null; eventType: string; createdAt: string }[];
    documents: { id: string; documentType: string; stageKey: string; uploadedAt: string }[];
    messages: { id: string; senderId: string; body: string; bodyScrubbed: boolean; createdAt: string }[];
  };
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700',
  investigating: 'bg-blue-50 text-blue-700',
  resolved_upheld: 'bg-red-50 text-red-700',
  resolved_dismissed: 'bg-gray-100 text-gray-500',
  withdrawn: 'bg-gray-100 text-gray-500',
};

const who = (u: { phone: string | null; email: string | null } | null) =>
  u?.phone ?? u?.email ?? '—';

/**
 * Admin dispute centre (Plan §6.7). Evidence is assembled by the platform —
 * timeline, documents and chat export — so an admin never has to ask either
 * party for their version of events.
 */
export default function AdminDisputesPage() {
  const t = useTranslations('adminDisputes');
  const locale = useLocale();
  const [rows, setRows] = useState<DisputeRow[] | null>(null);
  const [open, setOpen] = useState<Bundle | null>(null);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await apiGet<DisputeRow[]>(`/admin/disputes${status ? `?status=${status}` : ''}`));
  }, [status]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [load]);

  const openBundle = async (id: string) => {
    setError(null);
    try {
      setOpen(await apiGet<Bundle>(`/admin/disputes/${id}`));
      setNote('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const [statement, setStatement] = useState('');

  const postStatement = async () => {
    if (!open || !statement.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/admin/disputes/${open.id}/statements`, { body: statement });
      setStatement('');
      await openBundle(open.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (next: string) => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/admin/disputes/${open.id}/resolve`, { status: next, resolutionNote: note });
      await load();
      await openBundle(open.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isOpen = open && ['open', 'investigating'].includes(open.status);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <select
        className="mt-6 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">{t('allStatuses')}</option>
        {['open', 'investigating', 'resolved_upheld', 'resolved_dismissed'].map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </select>

      {!rows ? (
        <p className="mt-8 text-gray-400">…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-gray-500">{t('empty')}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((d) => (
            <li key={d.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[d.status]}`}>
                  {t(`status.${d.status}`)}
                </span>
                <span className="text-sm text-gray-500">
                  {who(d.openedByUser)} → {who(d.againstUser)}
                </span>
                <span className="ms-auto text-xs text-gray-400">
                  {new Date(d.createdAt).toLocaleDateString(locale)}
                </span>
              </div>
              <p className="mt-2 text-sm">{d.reason}</p>
              <button
                className="mt-2 text-sm font-medium text-brand-600"
                onClick={() => openBundle(d.id)}
              >
                {t('openEvidence')} →
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <section className="mt-8 rounded-xl border-2 border-brand-600 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t('evidence')}</h2>
            <button className="text-sm text-gray-500" onClick={() => setOpen(null)}>
              {t('close')}
            </button>
          </div>

          {open.deal && (
            <p className="mt-2 text-sm text-gray-600">
              {open.deal.title ?? open.deal.id} · {open.deal.kind} · {open.deal.status} ·{' '}
              {open.deal.priceAgreed !== null &&
                new Intl.NumberFormat(locale, {
                  style: 'currency',
                  currency: open.deal.currency ?? 'GBP',
                  maximumFractionDigits: 0,
                }).format(open.deal.priceAgreed)}
            </p>
          )}

          {/* The parties' own words, beside the platform-assembled evidence
              (step 26). An admin question posted here reaches both sides. */}
          <h3 className="mt-4 text-sm font-semibold">{t('statements.title')}</h3>
          {open.statements.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">{t('statements.none')}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {open.statements.map((st) => (
                <li key={st.id} className={`rounded px-2 py-1 ${st.byAdmin ? 'bg-brand-50' : 'bg-gray-50'}`}>
                  <span className="text-gray-400">
                    {st.byAdmin
                      ? t('statements.byAdmin')
                      : st.authorUserId === open.openedByUser?.id
                        ? t('statements.byOpener')
                        : t('statements.byRespondent')}{' '}
                    · {new Date(st.createdAt).toLocaleString(locale)}
                  </span>
                  <p>{st.body}</p>
                </li>
              ))}
            </ul>
          )}
          {isOpen && (
            <div className="mt-2 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder={t('statements.placeholder')}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
              />
              <button
                disabled={busy || !statement.trim()}
                onClick={() => void postStatement()}
                className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-600 disabled:opacity-50"
              >
                {t('statements.send')}
              </button>
            </div>
          )}

          <h3 className="mt-4 text-sm font-semibold">{t('timeline')}</h3>
          <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
            {open.evidence.events.map((e) => (
              <li key={e.id}>
                • {e.eventType} — {new Date(e.createdAt).toLocaleString(locale)}
              </li>
            ))}
          </ul>

          <h3 className="mt-4 text-sm font-semibold">{t('documents')}</h3>
          {open.evidence.documents.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">{t('noDocuments')}</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
              {open.evidence.documents.map((d) => (
                <li key={d.id}>
                  • {d.documentType} ({d.stageKey})
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-sm font-semibold">{t('chatExport')}</h3>
          {open.evidence.messages.length === 0 ? (
            <p className="mt-1 text-xs text-gray-400">{t('noMessages')}</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {open.evidence.messages.map((m) => (
                <li key={m.id} className="rounded bg-gray-50 px-2 py-1">
                  <span className="text-gray-400">
                    {new Date(m.createdAt).toLocaleString(locale)}
                    {/* the mask itself is evidence of a §2.4 bypass attempt */}
                    {m.bodyScrubbed && ` · ${t('scrubbed')}`}
                  </span>
                  <p>{m.body}</p>
                </li>
              ))}
            </ul>
          )}

          {isOpen ? (
            <div className="mt-5 border-t border-gray-200 pt-4">
              <label className="block text-sm font-medium">{t('resolution')}</label>
              <textarea
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                rows={2}
                placeholder={t('notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-400">{t('upheldHint')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy || !note.trim()}
                  onClick={() => resolve('resolved_upheld')}
                >
                  {t('uphold')}
                </button>
                <button
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-50"
                  disabled={busy || !note.trim()}
                  onClick={() => resolve('resolved_dismissed')}
                >
                  {t('dismiss')}
                </button>
                {open.status === 'open' && (
                  <button
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm disabled:opacity-50"
                    disabled={busy}
                    onClick={() => resolve('investigating')}
                  >
                    {t('investigate')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            open.resolutionNote && (
              <p className="mt-5 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                {t('resolved')}: {open.resolutionNote}
              </p>
            )
          )}
        </section>
      )}
    </div>
  );
}
