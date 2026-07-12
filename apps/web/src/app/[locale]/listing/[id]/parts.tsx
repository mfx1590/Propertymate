'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost, getAccessToken } from '../../../../lib/api';
import { useRouter } from '../../../../i18n/routing';
import type { Property } from '../../../../lib/listings';

const MapView = dynamic(() => import('../../../../components/MapView'), { ssr: false });

export function DetailMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return <MapView center={{ lat, lng }} zoom={14} markers={[{ id: 'x', lat, lng, label }]} />;
}

export function ActionBox({ propertyId }: { propertyId: string }) {
  const t = useTranslations('listings');
  const router = useRouter();
  const [tab, setTab] = useState<'inquire' | 'viewing' | 'offer' | null>(null);
  const [message, setMessage] = useState('');
  const [datetime, setDatetime] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, doneMsg: string) => {
    if (!getAccessToken()) {
      router.push('/auth');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDone(doneMsg);
      setTab(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';
  const btnCls = 'w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50';

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-4">
      {done && <p className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">{done}</p>}
      <div className="grid grid-cols-3 gap-1 text-xs font-medium">
        {(['inquire', 'viewing', 'offer'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(tab === k ? null : k)}
            className={`rounded-lg px-2 py-2 ${tab === k ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {t(`actions.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'inquire' && (
        <div className="space-y-2">
          <textarea className={inputCls} rows={3} placeholder={t('actions.messagePlaceholder')} value={message} onChange={(e) => setMessage(e.target.value)} />
          <button
            className={btnCls}
            disabled={busy || !message.trim()}
            onClick={() =>
              run(async () => {
                await apiPost(`/properties/${propertyId}/inquire`, { message });
                router.push('/dashboard/messages');
              }, t('actions.sent'))
            }
          >
            {t('actions.send')}
          </button>
        </div>
      )}
      {tab === 'viewing' && (
        <div className="space-y-2">
          <input className={inputCls} type="datetime-local" value={datetime} onChange={(e) => setDatetime(e.target.value)} />
          <button
            className={btnCls}
            disabled={busy || !datetime}
            onClick={() =>
              run(async () => {
                await apiPost(`/properties/${propertyId}/viewings`, { scheduledAt: new Date(datetime).toISOString() });
              }, t('actions.viewingRequested'))
            }
          >
            {t('actions.requestViewing')}
          </button>
        </div>
      )}
      {tab === 'offer' && (
        <div className="space-y-2">
          <input className={inputCls} type="number" min={1} placeholder={t('actions.amountGbp')} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button
            className={btnCls}
            disabled={busy || !amount}
            onClick={() =>
              run(async () => {
                await apiPost(`/properties/${propertyId}/offers`, { amount: Number(amount), currency: 'GBP' });
              }, t('actions.offerSent'))
            }
          >
            {t('actions.makeOffer')}
          </button>
        </div>
      )}
      {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <p className="text-[11px] text-gray-400">{t('actions.antiBypassNote')}</p>
    </div>
  );
}

export function FavoriteButton({ propertyId }: { propertyId: string }) {
  const t = useTranslations('listings');
  const router = useRouter();
  const [favored, setFavored] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) return;
    setAuthed(true);
    void apiGet<Property[]>('/users/me/favorites')
      .then((favs) => setFavored(favs.some((f) => f.id === propertyId)))
      .catch(() => undefined);
  }, [propertyId]);

  const toggle = async () => {
    if (!authed) {
      router.push('/auth');
      return;
    }
    if (favored) {
      await apiDelete(`/properties/${propertyId}/favorite`);
      setFavored(false);
    } else {
      await apiPost(`/properties/${propertyId}/favorite`);
      setFavored(true);
    }
  };

  return (
    <button
      onClick={toggle}
      className={`w-full rounded-xl border-2 px-4 py-3 font-medium transition ${
        favored
          ? 'border-rose-300 bg-rose-50 text-rose-600'
          : 'border-gray-200 text-gray-700 hover:border-rose-300'
      }`}
    >
      {favored ? `♥ ${t('detail.saved')}` : `♡ ${t('detail.save')}`}
    </button>
  );
}
