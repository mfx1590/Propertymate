'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../lib/api';
import { Link, useRouter } from '../../../../i18n/routing';
import { fmtMoney } from '../../../../lib/listings';
import { PROJECT_STATUS_STYLES, pickI18n, type MyProject } from '../../../../lib/projects';

export default function MyProjectsPage() {
  const t = useTranslations('projects');
  const locale = useLocale();
  const router = useRouter();
  const [items, setItems] = useState<MyProject[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<MyProject[]>('/projects/mine').then(setItems);
  }, []);

  // The draft is created here rather than on the editor's mount so an idle visit
  // to /new never leaves an orphan draft behind.
  const startDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await apiPost<{ id: string }>('/projects');
      router.push(`/dashboard/projects/new?id=${p.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setBusy(false);
    }
  };

  if (!items) return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('board.title')}</h1>
        <button
          onClick={startDraft}
          disabled={busy}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          + {t('board.new')}
        </button>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {items.length === 0 && <p className="mt-8 text-gray-500">{t('board.empty')}</p>}

      <ul className="mt-6 space-y-3">
        {items.map((p) => {
          const name = pickI18n(p.nameI18n, locale);
          const stats = p.unitStats;
          return (
            <li key={p.id} className="flex gap-4 rounded-xl border border-gray-200 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {p.media[0] ? (
                <img src={p.media[0].url} alt="" className="h-24 w-32 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">
                  🏗️
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PROJECT_STATUS_STYLES[p.status] ?? ''}`}
                  >
                    {t(`status.${p.status}`)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {p._count.units} {t('board.units')} · {p._count.updates} {t('board.updates')}
                  </span>
                </div>
                <p className="mt-1 truncate font-medium">{name || t('board.untitled')}</p>
                <p className="text-sm text-gray-500">
                  {pickI18n(p.region?.nameI18n, locale) || p.region?.slug}
                  {stats.total > 0 &&
                    ` · ${t('board.availability', { available: stats.available, total: stats.total })}`}
                  {stats.priceFrom !== null &&
                    stats.currency &&
                    ` · ${t('detail.from')} ${fmtMoney(stats.priceFrom, stats.currency)}`}
                </p>
                <p className="text-sm text-gray-400">
                  {p.deliveryDate
                    ? `${t('board.delivery')}: ${new Date(p.deliveryDate).toLocaleDateString(locale)}`
                    : t('board.noDelivery')}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  {p.status === 'draft' && (
                    <Link href={`/dashboard/projects/new?id=${p.id}`} className="font-medium text-brand-600">
                      {t('board.continue')}
                    </Link>
                  )}
                  <Link href={`/dashboard/projects/${p.id}`} className="font-medium text-brand-600">
                    {t('board.manageUnits')}
                  </Link>
                  {p.status !== 'draft' && (
                    <Link href={`/projects/${p.id}`} className="text-gray-500">
                      {t('board.view')}
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
