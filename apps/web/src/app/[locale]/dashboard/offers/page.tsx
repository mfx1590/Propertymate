'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/listings';
import { EmptyState } from '../../../../components/EmptyState';

interface Offer {
  id: string;
  status: string;
  amount: string;
  currency: string;
  termsNote: string | null;
  parentOfferId: string | null;
  createdAt: string;
  property: { id: string; titleI18n: { en?: string } };
}

const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-amber-50 text-amber-700',
  countered: 'bg-blue-50 text-blue-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
  withdrawn: 'bg-gray-100 text-gray-500',
};

export default function OffersPage() {
  const t = useTranslations('offers');
  const [data, setData] = useState<{ sent: Offer[]; received: Offer[] } | null>(null);
  const [counter, setCounter] = useState<Record<string, string>>({});
  const [offersEnabled, setOffersEnabled] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => apiGet<{ sent: Offer[]; received: Offer[] }>('/users/me/offers').then(setData), []);
  useEffect(() => {
    void load();
    void apiGet<{ offersEnabled: boolean }>('/settings/public')
      .then((s) => setOffersEnabled(Boolean(s.offersEnabled)))
      .catch(() => undefined);
  }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <p className="text-gray-400">…</p>;

  const OfferCard = ({ o, received }: { o: Offer; received: boolean }) => (
    <li className="rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[o.status] ?? ''}`}>
          {t(`status.${o.status}`)}
        </span>
        {o.parentOfferId && <span className="text-xs text-gray-400">{t('counterOf')}</span>}
        <span className="ms-auto text-lg font-bold text-brand-600">{fmtMoney(Number(o.amount), o.currency)}</span>
      </div>
      <p className="mt-1 font-medium">{o.property.titleI18n.en}</p>
      {o.termsNote && <p className="text-sm text-gray-500">{o.termsNote}</p>}
      {['submitted', 'countered'].includes(o.status) && (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {received ? (
            <>
              <button disabled={busy === o.id} onClick={() => act(o.id, () => apiPost(`/offers/${o.id}/respond`, { action: 'accept' }))} className="rounded-lg bg-emerald-600 px-4 py-1.5 font-medium text-white disabled:opacity-50">
                {t('accept')}
              </button>
              <button disabled={busy === o.id} onClick={() => act(o.id, () => apiPost(`/offers/${o.id}/respond`, { action: 'reject' }))} className="rounded-lg border border-gray-300 px-4 py-1.5 disabled:opacity-50">
                {t('reject')}
              </button>
              <input
                type="number"
                className="w-32 rounded-lg border border-gray-300 px-3 py-1.5"
                placeholder={t('counterAmount')}
                value={counter[o.id] ?? ''}
                onChange={(e) => setCounter((c) => ({ ...c, [o.id]: e.target.value }))}
              />
              <button
                disabled={busy === o.id || !counter[o.id]}
                onClick={() => act(o.id, () => apiPost(`/offers/${o.id}/counter`, { amount: Number(counter[o.id]) }))}
                className="rounded-lg border border-brand-600 px-4 py-1.5 font-medium text-brand-600 disabled:opacity-50"
              >
                {t('counter')}
              </button>
            </>
          ) : (
            <button disabled={busy === o.id} onClick={() => act(o.id, () => apiPost(`/offers/${o.id}/respond`, { action: 'withdraw' }))} className="rounded-lg border border-gray-300 px-4 py-1.5 text-gray-500 disabled:opacity-50">
              {t('withdraw')}
            </button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      {/* Offers are behind an admin toggle (change log 2026-08-10). Anything
          already in flight stays actionable, so the list below still renders —
          this only explains why no new offer can be made. */}
      {!offersEnabled && (
        <p className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('disabled')}
        </p>
      )}

      <h2 className="mt-6 font-semibold text-gray-700">{t('received')}</h2>
      {/* Receiving an offer needs listings, not the toggle — that action stays
          useful even while new offers are switched off. */}
      {data.received.length === 0 && (
        <EmptyState
          icon="📥"
          title={t('emptyReceived.title')}
          body={t('emptyReceived.body')}
          action={{ label: t('emptyReceived.action'), href: '/dashboard/listings' }}
        />
      )}
      <ul className="mt-2 space-y-2">
        {data.received.map((o) => (
          <OfferCard key={o.id} o={o} received />
        ))}
      </ul>

      <h2 className="mt-8 font-semibold text-gray-700">{t('sent')}</h2>
      {/* No CTA while the toggle is off: sending the user to a listing to make
          an offer they cannot make is exactly the dead end this pass removes.
          The amber banner above already explains why. */}
      {data.sent.length === 0 && (
        <EmptyState
          icon="📤"
          title={t('emptySent.title')}
          body={t('emptySent.body')}
          action={offersEnabled ? { label: t('emptySent.action'), href: '/search' } : undefined}
        />
      )}
      <ul className="mt-2 space-y-2">
        {data.sent.map((o) => (
          <OfferCard key={o.id} o={o} received={false} />
        ))}
      </ul>
    </div>
  );
}
