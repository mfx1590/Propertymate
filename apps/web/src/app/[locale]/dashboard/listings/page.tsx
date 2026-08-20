'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../lib/api';
import { Link } from '../../../../i18n/routing';
import { fmtMoney, type Property } from '../../../../lib/listings';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending_verification: 'bg-amber-50 text-amber-700',
  verified_private: 'bg-indigo-50 text-indigo-700',
  live: 'bg-emerald-50 text-emerald-700',
  paused: 'bg-gray-100 text-gray-500',
  under_offer: 'bg-blue-50 text-blue-700',
  sold: 'bg-purple-50 text-purple-700',
  rented: 'bg-purple-50 text-purple-700',
};

export default function MyListingsPage() {
  const t = useTranslations('listings');
  const locale = useLocale();
  const [items, setItems] = useState<Property[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [featureError, setFeatureError] = useState<string | null>(null);

  const load = () => apiGet<Property[]>('/properties/mine').then(setItems);
  useEffect(() => {
    void load();
  }, []);

  const confirmAvailability = async (id: string) => {
    setBusyId(id);
    try {
      await apiPost(`/properties/${id}/confirm-availability`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  /** §8: spend an earned featured credit on this listing. */
  const feature = async (id: string) => {
    setBusyId(id);
    setFeatureError(null);
    try {
      await apiPost(`/properties/${id}/feature`, {});
      await load();
    } catch (e) {
      setFeatureError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!items) return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('board.title')}</h1>
        <Link
          href="/dashboard/listings/new"
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white"
        >
          + {t('board.newListing')}
        </Link>
      </div>

      {items.length === 0 && <p className="mt-8 text-gray-500">{t('board.empty')}</p>}
      {featureError && (
        <p className="mb-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{featureError}</p>
      )}

      <ul className="mt-6 space-y-3">
        {items.map((p) => (
          <li key={p.id} className="flex gap-4 rounded-xl border border-gray-200 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.media[0] ? (
              <img src={p.media[0].url} alt="" className="h-24 w-32 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">🏠</div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[p.status] ?? ''}`}>
                  {t(`status.${p.status}`)}
                </span>
                <span className="text-xs text-gray-400">{t(`kind.${p.kind}`)}</span>
              </div>
              <p className="mt-1 truncate font-medium">{p.titleI18n?.en || t('board.untitled')}</p>
              {/* A status badge alone does not explain itself. `verified_private`
                  in particular reads like success while the listing is invisible
                  to buyers, which is the single biggest source of "why can nobody
                  see my property?" */}
              {t.has(`statusHelp.${p.status}`) && (
                <p className="mt-0.5 text-xs text-gray-500">{t(`statusHelp.${p.status}`)}</p>
              )}
              <p className="text-sm text-gray-500">
                {p.region.nameI18n[locale] ?? p.region.nameI18n.en}
                {Number(p.priceAmount) > 0 && ` · ${fmtMoney(Number(p.priceAmount), p.priceCurrency)}`}
                {` · ${p.viewCount} ${t('board.views')} · ${p.saveCount} ${t('board.saves')}`}
              </p>
              <div className="mt-2 flex gap-3 text-sm">
                {p.status === 'draft' && (
                  <Link href={`/dashboard/listings/new?id=${p.id}`} className="font-medium text-brand-600">
                    {t('board.continue')}
                  </Link>
                )}
                {p.status === 'verified_private' && (
                  <Link href={`/dashboard/listings/${p.id}/find-agent`} className="font-medium text-indigo-600">
                    {t('board.findAgent')}
                  </Link>
                )}
                {(p.status === 'live' || p.status === 'paused') && (
                  <button
                    className="font-medium text-brand-600 disabled:opacity-50"
                    disabled={busyId === p.id}
                    onClick={() => confirmAvailability(p.id)}
                  >
                    {t('board.confirmAvailability')}
                  </button>
                )}
                {/* §8: spend an earned featured credit. Live only — a boost
                    reorders verified supply, it never promotes unverified. */}
                {p.status === 'live' && (
                  <button
                    className="font-medium text-brand-600 disabled:opacity-50"
                    disabled={busyId === p.id}
                    onClick={() => feature(p.id)}
                  >
                    {t('board.feature')}
                  </button>
                )}
                {p.status !== 'draft' && (
                  <Link href={`/listing/${p.id}`} className="text-gray-500">
                    {t('board.view')}
                  </Link>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
