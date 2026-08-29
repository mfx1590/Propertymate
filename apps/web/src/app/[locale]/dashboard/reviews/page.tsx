'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { API_BASE } from '../../../../lib/listings';
import { EmptyState } from '../../../../components/EmptyState';

interface PublicReview {
  id: string;
  stars: number;
  tags: string[];
  comment: string | null;
  removed: boolean;
  revealedAt: string;
}

interface ReviewsPayload {
  count: number;
  avgStars: number | null;
  reviews: PublicReview[];
}

interface MyReport {
  id: string;
  reason: string;
  status: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  rating: { id: string; stars: number; comment: string | null; removed: boolean };
}

const REPORT_STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-50 text-amber-700',
  upheld: 'bg-emerald-50 text-emerald-700',
  dismissed: 'bg-gray-100 text-gray-500',
};

/**
 * What a professional sees about their own reputation (Plan §13.2).
 *
 * The one thing this page deliberately does not offer is a delete button.
 * Reviews are not the profile owner's to remove — reporting one to an admin is
 * the only lever, and the page says so rather than leaving people hunting for
 * a control that will never exist.
 */
export default function MyReviewsPage() {
  const t = useTranslations('myReviews');
  const locale = useLocale();
  const { me } = useAuth();
  const [data, setData] = useState<ReviewsPayload | null>(null);
  const [reports, setReports] = useState<MyReport[]>([]);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!me) return;
    // Reviews are a public payload, so this is the same view a buyer gets —
    // no private variant to drift out of step with what everyone else sees.
    const res = await fetch(`${API_BASE}/users/${me.id}/reviews`, { cache: 'no-store' });
    setData(await res.json());
    setReports(await apiGet<MyReport[]>('/users/me/review-reports').catch(() => []));
  }, [me]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitReport = async (ratingId: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/reviews/${ratingId}/report`, { reason: reason.trim() });
      setReporting(null);
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-gray-400">…</p>;

  const reportedIds = new Set(reports.map((r) => r.rating.id));

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {data.count > 0 && (
        <p className="mt-4 text-sm text-gray-600">
          {t('summary', { count: data.count, avg: (data.avgStars ?? 0).toFixed(1) })}
        </p>
      )}

      {data.count === 0 && (
        <EmptyState
          icon="⭐"
          title={t('emptyState.title')}
          body={t('emptyState.body')}
          action={{ label: t('emptyState.action'), href: '/dashboard/deals' }}
        />
      )}

      <ul className="mt-6 space-y-3">
        {data.reviews.map((r) => (
          <li key={r.id} className="rounded-xl border border-gray-200 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {/* Colour alone must not carry the rating: an empty star is a
                  different glyph, and the label states the number outright. */}
              <span className="text-sm text-amber-500" aria-label={t('starsLabel', { stars: r.stars })}>
                {'★'.repeat(r.stars)}
                <span className="text-gray-300">{'☆'.repeat(5 - r.stars)}</span>
              </span>
              <span className="ms-auto text-xs text-gray-400">
                {new Date(r.revealedAt).toLocaleDateString(locale)}
              </span>
            </div>

            {r.removed ? (
              <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">{t('removed')}</p>
            ) : (
              <p className="mt-2 text-sm italic text-gray-800">“{r.comment ?? ''}”</p>
            )}

            {r.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {!r.removed && !reportedIds.has(r.id) && r.comment && (
              reporting === r.id ? (
                <div className="mt-3">
                  <textarea
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('reasonPlaceholder')}
                  />
                  {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={busy || !reason.trim()}
                      onClick={() => submitReport(r.id)}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {t('submitReport')}
                    </button>
                    <button
                      onClick={() => {
                        setReporting(null);
                        setReason('');
                        setError(null);
                      }}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setReporting(r.id)}
                  className="mt-3 text-sm font-medium text-gray-500 hover:text-brand-600"
                >
                  {t('report')}
                </button>
              )
            )}

            {reportedIds.has(r.id) && (
              <p className="mt-3 text-xs text-gray-500">{t('alreadyReported')}</p>
            )}
          </li>
        ))}
      </ul>

      {/* Say the quiet part out loud: you cannot delete these. */}
      <p className="mt-6 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">{t('cannotDeleteNote')}</p>

      {reports.length > 0 && (
        <>
          <h2 className="mt-8 font-semibold text-gray-700">{t('reportsTitle')}</h2>
          <ul className="mt-3 space-y-2">
            {reports.map((r) => (
              <li key={r.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REPORT_STATUS_STYLES[r.status] ?? ''}`}
                  >
                    {t(`reportStatus.${r.status}`)}
                  </span>
                  <span className="ms-auto text-xs text-gray-400">
                    {new Date(r.createdAt).toLocaleDateString(locale)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-600">{r.reason}</p>
                {r.resolutionNote && <p className="mt-1 text-xs text-gray-500">{r.resolutionNote}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
