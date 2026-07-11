'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../../lib/api';
import { Link } from '../../../../../i18n/routing';

interface QueueItem {
  id: string;
  entityType: string;
  entityId: string;
  status: string;
  claimedByAdminId: string | null;
  slaDueAt: string;
  overdue: boolean;
  summary: { label: string; kind?: string; region?: string; lister?: string };
}

interface Metrics {
  queueDepth: number;
  overdue: number;
  approvalRate: number | null;
  avgTurnaroundHours: number;
}

function slaLabel(slaDueAt: string): string {
  const ms = new Date(slaDueAt).getTime() - Date.now();
  const h = Math.floor(Math.abs(ms) / 3_600_000);
  const m = Math.floor((Math.abs(ms) % 3_600_000) / 60_000);
  return ms < 0 ? `-${h}h ${m}m` : `${h}h ${m}m`;
}

export default function AdminQueuePage() {
  const t = useTranslations('admin');
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [entityType, setEntityType] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = entityType ? `?entityType=${entityType}` : '';
      const [queue, m] = await Promise.all([
        apiGet<QueueItem[]>(`/admin/verification/queue${qs}`),
        apiGet<Metrics>('/admin/verification/metrics'),
      ]);
      setItems(queue);
      setMetrics(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = async (id: string) => {
    await apiPost(`/admin/verification/${id}/claim`);
    await load();
  };

  if (error) return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!items) return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">{t('queue.title')}</h1>

      {metrics && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [t('queue.depth'), metrics.queueDepth],
            [t('queue.overdue'), metrics.overdue],
            [t('queue.approvalRate'), metrics.approvalRate === null ? '—' : `${Math.round(metrics.approvalRate * 100)}%`],
            [t('queue.turnaround'), `${metrics.avgTurnaroundHours}h`],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400">{k}</p>
              <p className="text-2xl font-bold">{v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex gap-2">
        {['', 'listing', 'profile'].map((et) => (
          <button
            key={et}
            onClick={() => setEntityType(et)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              entityType === et ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {et === '' ? t('queue.all') : t(`queue.type.${et}`)}
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="mt-8 text-gray-500">{t('queue.empty')}</p>}

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 rounded-xl border border-gray-200 p-4">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${item.entityType === 'listing' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
              {t(`queue.type.${item.entityType}`)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{item.summary.label}</p>
              <p className="text-xs text-gray-500">
                {item.summary.lister}
                {item.summary.region && ` · ${item.summary.region}`}
              </p>
            </div>
            <span className={`text-sm font-semibold ${item.overdue ? 'text-red-600' : 'text-gray-500'}`}>
              {item.overdue ? t('queue.overdueBy') : t('queue.slaIn')} {slaLabel(item.slaDueAt)}
            </span>
            {item.status === 'queued' ? (
              <button onClick={() => claim(item.id)} className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-600">
                {t('queue.claim')}
              </button>
            ) : (
              <span className="text-xs text-gray-400">{t('queue.claimed')}</span>
            )}
            <Link href={`/dashboard/admin/queue/${item.id}`} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
              {t('queue.review')}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
