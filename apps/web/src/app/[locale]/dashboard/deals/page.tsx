'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet } from '../../../../lib/api';
import { Link } from '../../../../i18n/routing';
import { fmtMoney } from '../../../../lib/listings';
import { EmptyState } from '../../../../components/EmptyState';

interface DealRow {
  id: string;
  kind: string;
  status: string;
  currentStageKey: string;
  property: { id: string; titleI18n: { en?: string }; media: { url: string }[] } | null;
  snapshot: { priceAgreed: string; currency: string } | null;
  progress: { completed: number; total: number };
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

export default function DealsPage() {
  const t = useTranslations('deals');
  const [deals, setDeals] = useState<DealRow[] | null>(null);

  useEffect(() => {
    void apiGet<DealRow[]>('/deals').then(setDeals).catch(() => setDeals([]));
  }, []);

  if (!deals) return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
      {deals.length === 0 && (
        <EmptyState
          icon="🤝"
          title={t('emptyState.title')}
          body={t('emptyState.body')}
          action={{ label: t('emptyState.action'), href: '/search' }}
        />
      )}
      <ul className="mt-6 space-y-3">
        {deals.map((d) => (
          <li key={d.id}>
            <Link href={`/dashboard/deals/${d.id}`} className="flex gap-4 rounded-xl border border-gray-200 p-3 transition hover:border-brand-500 hover:shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {d.property?.media[0] ? (
                <img src={d.property.media[0].url} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-2xl">🤝</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[d.status] ?? ''}`}>
                    {t(`status.${d.status}`)}
                  </span>
                  <span className="text-xs text-gray-400">{t(`kind.${d.kind}`)}</span>
                </div>
                <p className="mt-1 truncate font-medium">{d.property?.titleI18n.en}</p>
                <p className="text-sm text-gray-500">
                  {d.snapshot && fmtMoney(Number(d.snapshot.priceAgreed), d.snapshot.currency)} ·{' '}
                  {t(`stages.${d.currentStageKey}`)}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.progress.completed / d.progress.total) * 100}%` }} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
