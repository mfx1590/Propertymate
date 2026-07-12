'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet } from '../../../../../lib/api';
import { fmtGbp } from '../../../../../lib/listings';

interface Row {
  id: string;
  titleI18n: { en?: string };
  status: string;
  priceBaseGbp: string;
  platformProfitGbp: string | null;
  agentCommissionGbp: string | null;
  listPriceGbp: string | null;
  createdBy: { email: string | null; phone: string | null };
  region: { slug: string };
  assignments: { status: string; agentUserId: string; termMonths: number; expiresAt: string }[];
}

export default function MediatedListingsPage() {
  const t = useTranslations('mediated');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<Row[]>('/admin/mediated-listings')
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!rows) return <p className="text-gray-400">…</p>;

  const totalProfit = rows.reduce((s, r) => s + Number(r.platformProfitGbp ?? 0), 0);

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">
        {t('summary', { count: rows.length })} · {t('projectedProfit')}: <b>{fmtGbp(totalProfit)}</b>
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              {['property', 'owner', 'status', 'ask', 'profit', 'commission', 'listPrice', 'agents'].map((h) => (
                <th key={h} className="p-2 text-start">{t(`cols.${h}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gray-100">
                <td className="max-w-52 truncate p-2 font-medium">{r.titleI18n.en ?? '—'}</td>
                <td className="p-2 text-gray-500">{r.createdBy.email ?? r.createdBy.phone}</td>
                <td className="p-2">{r.status}</td>
                <td className="p-2">{fmtGbp(Number(r.priceBaseGbp))}</td>
                <td className="p-2 font-semibold text-brand-600">
                  {r.platformProfitGbp ? fmtGbp(Number(r.platformProfitGbp)) : '—'}
                </td>
                <td className="p-2">{r.agentCommissionGbp ? fmtGbp(Number(r.agentCommissionGbp)) : '—'}</td>
                <td className="p-2 font-semibold">{r.listPriceGbp ? fmtGbp(Number(r.listPriceGbp)) : '—'}</td>
                <td className="p-2 text-xs text-gray-500">
                  {r.assignments.map((a) => a.status).join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
