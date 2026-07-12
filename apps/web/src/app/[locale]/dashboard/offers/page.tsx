'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../lib/api';
import { fmtMoney } from '../../../../lib/listings';

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
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => apiGet<{ sent: Offer[]; received: Offer[] }>('/users/me/offers').then(setData), []);
  useEffect(() => {
    void load();
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

      <h2 className="mt-6 font-semibold text-gray-700">{t('received')}</h2>
      {data.received.length === 0 && <p className="mt-2 text-sm text-gray-500">{t('none')}</p>}
      <ul className="mt-2 space-y-2">
        {data.received.map((o) => (
          <OfferCard key={o.id} o={o} received />
        ))}
      </ul>

      <h2 className="mt-8 font-semibold text-gray-700">{t('sent')}</h2>
      {data.sent.length === 0 && <p className="mt-2 text-sm text-gray-500">{t('none')}</p>}
      <ul className="mt-2 space-y-2">
        {data.sent.map((o) => (
          <OfferCard key={o.id} o={o} received={false} />
        ))}
      </ul>
    </div>
  );
}
