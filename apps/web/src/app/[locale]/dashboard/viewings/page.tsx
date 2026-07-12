'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { api, apiGet } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';

interface Viewing {
  id: string;
  status: string;
  scheduledAt: string;
  notes: string | null;
  customerId: string;
  hostUserId: string;
  property: { id: string; titleI18n: { en?: string }; region: { slug: string } };
}

const STATUS_STYLES: Record<string, string> = {
  requested: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-blue-50 text-blue-700',
  cancelled: 'bg-gray-100 text-gray-500',
  no_show: 'bg-red-50 text-red-700',
};

export default function ViewingsPage() {
  const t = useTranslations('viewings');
  const locale = useLocale();
  const { me } = useAuth();
  const [items, setItems] = useState<Viewing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => apiGet<Viewing[]>('/users/me/viewings').then(setItems), []);
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: string, status: string) => {
    setBusy(id);
    try {
      await api(`/viewings/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!items) return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {items.length === 0 && <p className="mt-6 text-gray-500">{t('empty')}</p>}
      <ul className="mt-6 space-y-2">
        {items.map((v) => {
          const isHost = v.hostUserId === me?.id;
          return (
            <li key={v.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[v.status] ?? ''}`}>
                  {t(`status.${v.status}`)}
                </span>
                <span className="text-xs text-gray-400">{isHost ? t('asHost') : t('asCustomer')}</span>
                <span className="ms-auto text-sm font-medium">
                  {new Date(v.scheduledAt).toLocaleString(locale)}
                </span>
              </div>
              <p className="mt-1 font-medium">{v.property.titleI18n.en}</p>
              {v.notes && <p className="text-sm text-gray-500">{v.notes}</p>}
              <div className="mt-2 flex gap-2 text-sm">
                {isHost && v.status === 'requested' && (
                  <button disabled={busy === v.id} onClick={() => setStatus(v.id, 'confirmed')} className="rounded-lg bg-brand-600 px-4 py-1.5 font-medium text-white disabled:opacity-50">
                    {t('confirm')}
                  </button>
                )}
                {isHost && v.status === 'confirmed' && (
                  <>
                    <button disabled={busy === v.id} onClick={() => setStatus(v.id, 'completed')} className="rounded-lg bg-brand-600 px-4 py-1.5 font-medium text-white disabled:opacity-50">
                      {t('complete')}
                    </button>
                    <button disabled={busy === v.id} onClick={() => setStatus(v.id, 'no_show')} className="rounded-lg border border-gray-300 px-4 py-1.5 disabled:opacity-50">
                      {t('noShow')}
                    </button>
                  </>
                )}
                {['requested', 'confirmed'].includes(v.status) && (
                  <button disabled={busy === v.id} onClick={() => setStatus(v.id, 'cancelled')} className="rounded-lg border border-gray-300 px-4 py-1.5 text-gray-500 disabled:opacity-50">
                    {t('cancel')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
