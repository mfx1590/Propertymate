'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../lib/api';
import { fmtGbp } from '../../../../lib/listings';

interface Assignment {
  id: string;
  status: string;
  termMonths: number;
  expiresAt: string;
  property: {
    id: string;
    titleI18n: { en?: string };
    district: string | null;
    bedrooms: number | null;
    areaM2: number | null;
    deedType: string;
    priceBaseGbp: string;
    status: string;
    region: { slug: string };
    media: { id: string; url: string }[];
  } | null;
}

interface Published {
  id: string;
  titleI18n: { en?: string };
  status: string;
  agentCommissionGbp: string | null;
  listPriceGbp: string | null;
  viewCount: number;
  region: { slug: string };
}

export default function MandatesPage() {
  const t = useTranslations('mandates');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [published, setPublished] = useState<Published[]>([]);
  const [commission, setCommission] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([
      apiGet<Assignment[]>('/users/me/assignments'),
      apiGet<Published[]>('/users/me/published'),
    ]);
    setAssignments(a);
    setPublished(p);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {assignments.length === 0 && <p className="mt-6 text-gray-500">{t('empty')}</p>}

      <div className="mt-6 space-y-4">
        {assignments.map((a) => (
          <div key={a.id} className="rounded-xl border border-gray-200 p-4">
            <div className="flex gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.property?.media[0] && (
                <img src={a.property.media[0].url} alt="" className="h-24 w-32 shrink-0 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{a.property?.titleI18n.en}</p>
                <p className="text-sm text-gray-500">
                  {a.property?.region.slug}
                  {a.property?.district && ` · ${a.property.district}`} · {a.property?.bedrooms} bd ·{' '}
                  {a.property?.areaM2} m² · {a.property?.deedType}
                </p>
                <p className="mt-1 text-sm">
                  {t('ownerAsk')}: <b>{fmtGbp(Number(a.property?.priceBaseGbp ?? 0))}</b> · {t('termLabel')}:{' '}
                  {a.termMonths} {t('months')} · {t('until')} {new Date(a.expiresAt).toLocaleDateString()}
                </p>
                <p className="mt-1 text-xs text-gray-400">{t('anonymityNote')}</p>
              </div>
            </div>

            {a.status === 'invited' && (
              <div className="mt-3 flex gap-2">
                <button
                  disabled={busy === a.id}
                  onClick={() => act(a.id, () => apiPost(`/assignments/${a.id}/respond`, { action: 'accept' }))}
                  className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t('accept')}
                </button>
                <button
                  disabled={busy === a.id}
                  onClick={() => act(a.id, () => apiPost(`/assignments/${a.id}/respond`, { action: 'reject' }))}
                  className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {t('reject')}
                </button>
              </div>
            )}

            {a.status === 'accepted' && a.property?.status === 'verified_private' && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-3">
                <label className="text-sm font-medium">{t('commissionLabel')}</label>
                <input
                  type="number"
                  min={0}
                  className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="3000"
                  value={commission[a.id] ?? ''}
                  onChange={(e) => setCommission((c) => ({ ...c, [a.id]: e.target.value }))}
                />
                <button
                  disabled={busy === a.id || !commission[a.id]}
                  onClick={() =>
                    act(a.id, () => apiPost(`/assignments/${a.id}/publish`, { commissionGbp: Number(commission[a.id]) }))
                  }
                  className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t('publish')}
                </button>
                <span className="text-xs text-gray-400">{t('publishHint')}</span>
              </div>
            )}
            {a.status === 'accepted' && a.property?.status !== 'verified_private' && (
              <p className="mt-3 text-sm text-emerald-600">✓ {t('alreadyPublished')}</p>
            )}
          </div>
        ))}
      </div>

      {published.length > 0 && (
        <>
          <h2 className="mt-10 font-semibold text-gray-700">{t('publishedTitle')}</h2>
          <ul className="mt-3 space-y-2">
            {published.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-4 text-sm">
                <span className="font-medium">{p.titleI18n.en}</span>
                <span className="text-gray-500">
                  {t('listPrice')}: <b>{p.listPriceGbp ? fmtGbp(Number(p.listPriceGbp)) : '—'}</b> · {t('yourCommission')}:{' '}
                  <b>{p.agentCommissionGbp ? fmtGbp(Number(p.agentCommissionGbp)) : '—'}</b> · {p.viewCount} views
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
