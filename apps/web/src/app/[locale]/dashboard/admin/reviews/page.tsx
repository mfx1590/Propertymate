'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../../lib/api';
import { EmptyState } from '../../../../../components/EmptyState';

interface ReportRow {
  id: string;
  reason: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  reportedBy: { id: string; phone: string | null; email: string | null } | null;
  rating: {
    id: string;
    stars: number;
    comment: string | null;
    commentRemovedAt: string | null;
    createdAt: string;
    raterId: string;
  };
}

interface ReportDetail extends ReportRow {
  resolutionNote: string | null;
  author: { id: string; phone: string | null; email: string | null; status: string; createdAt: string } | null;
  warnings: { id: string; reason: string; createdAt: string; sourceType: string }[];
  warningCount: number;
  warningsBeforeBan: number;
  priorRemovals: number;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700',
  upheld: 'bg-red-50 text-red-700',
  dismissed: 'bg-gray-100 text-gray-500',
};

const who = (u: { phone: string | null; email: string | null } | null) => u?.phone ?? u?.email ?? '—';

/**
 * Review moderation queue (Plan §13.2).
 *
 * The decision an admin makes here is narrow on purpose: remove the *message*
 * or leave it. Neither option touches the star rating, because a professional
 * being able to lift their own score by reporting bad write-ups would undo the
 * point of having reviews at all — so the UI states that where the choice is
 * made rather than burying it in a policy page.
 */
export default function AdminReviewsPage() {
  const t = useTranslations('adminReviews');
  const locale = useLocale();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [status, setStatus] = useState('open');
  const [open, setOpen] = useState<ReportDetail | null>(null);
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await apiGet<ReportRow[]>(`/admin/review-reports${status ? `?status=${status}` : ''}`));
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setError(null);
    setNote('');
    setWarn(true);
    setOpen(await apiGet<ReportDetail>(`/admin/review-reports/${id}`));
  };

  const decide = async (action: 'remove' | 'dismiss') => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/admin/review-reports/${open.id}/decide`, {
        action,
        note: note.trim(),
        warn: action === 'remove' ? warn : false,
      });
      setOpen(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-4 flex gap-2">
        {['open', 'upheld', 'dismissed', ''].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              status === s ? 'border-brand-500 bg-brand-50 font-medium text-brand-600' : 'border-gray-300 text-gray-600'
            }`}
          >
            {s ? t(`status.${s}`) : t('all')}
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <EmptyState
          icon="🛡️"
          title={t('emptyState.title')}
          body={t('emptyState.body')}
          action={status !== '' ? { label: t('emptyState.action'), onClick: () => setStatus('') } : undefined}
        />
      )}

      <ul className="mt-6 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status] ?? ''}`}>
                {t(`status.${r.status}`)}
              </span>
              <span className="text-xs text-gray-400" aria-label={t('starsLabel', { stars: r.rating.stars })}>
                {'★'.repeat(r.rating.stars)}
                {'☆'.repeat(5 - r.rating.stars)}
              </span>
              <span className="ms-auto text-xs text-gray-400">
                {new Date(r.createdAt).toLocaleDateString(locale)}
              </span>
            </div>
            <p className="mt-2 text-sm italic text-gray-700">
              {r.rating.commentRemovedAt ? t('alreadyRemoved') : `“${r.rating.comment ?? ''}”`}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('reportedBy', { who: who(r.reportedBy) })} — {r.reason}
            </p>
            <button onClick={() => openDetail(r.id)} className="mt-3 text-sm font-medium text-brand-600">
              {t('review')}
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold">{t('detailTitle')}</h2>
              <button onClick={() => setOpen(null)} className="text-sm text-gray-500">
                {t('close')}
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('theReview')}</p>
              <p className="mt-1 text-sm text-gray-500" aria-label={t('starsLabel', { stars: open.rating.stars })}>
                {'★'.repeat(open.rating.stars)}
                {'☆'.repeat(5 - open.rating.stars)}
              </p>
              <p className="mt-2 text-sm italic text-gray-800">
                {open.rating.commentRemovedAt ? t('alreadyRemoved') : `“${open.rating.comment ?? ''}”`}
              </p>
            </div>

            <div className="mt-4 rounded-xl bg-gray-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('theReport')}</p>
              <p className="mt-1 text-sm text-gray-700">{open.reason}</p>
              <p className="mt-1 text-xs text-gray-500">{t('reportedBy', { who: who(open.reportedBy) })}</p>
            </div>

            {/* The author's record is what actually decides whether to warn. */}
            <div className="mt-4 rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('theAuthor')}</p>
              <p className="mt-1 text-sm font-medium text-gray-800">{who(open.author)}</p>
              <p className="mt-1 text-sm text-gray-600">
                {t('strikes', { count: open.warningCount, limit: open.warningsBeforeBan })}
              </p>
              {open.priorRemovals > 0 && (
                <p className="mt-0.5 text-sm text-gray-600">{t('priorRemovals', { count: open.priorRemovals })}</p>
              )}
              {open.warningCount + 1 >= open.warningsBeforeBan && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {t('banWarning')}
                </p>
              )}
              {open.warnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-gray-500">
                  {open.warnings.map((w) => (
                    <li key={w.id}>
                      {new Date(w.createdAt).toLocaleDateString(locale)} — {w.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {open.status === 'open' ? (
              <>
                <label className="mt-4 block text-sm font-medium text-gray-700">
                  {t('noteLabel')}
                  <textarea
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('notePlaceholder')}
                  />
                </label>

                <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} />
                  {t('warnAuthor')}
                </label>

                {/* Say plainly what each button does and does not do. */}
                <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">{t('starsNote')}</p>

                {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    disabled={busy || !note.trim()}
                    onClick={() => decide('remove')}
                    className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {t('removeComment')}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => decide('dismiss')}
                    className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium disabled:opacity-50"
                  >
                    {t('dismiss')}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
                {t('alreadyDecided', { status: t(`status.${open.status}`) })}
                {open.resolutionNote ? ` — ${open.resolutionNote}` : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
