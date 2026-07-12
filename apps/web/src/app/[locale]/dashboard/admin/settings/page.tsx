'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, apiGet, apiPost, apiPut } from '../../../../../lib/api';

interface Setting {
  key: string;
  value: unknown;
}
interface Band {
  id: string;
  minPriceGbp: string;
  maxPriceGbp: string;
  profitGbp: string;
  active: boolean;
}

export default function AdminSettingsPage() {
  const t = useTranslations('adminSettings');
  const [settings, setSettings] = useState<Setting[]>([]);
  const [bands, setBands] = useState<Band[]>([]);
  const [newBand, setNewBand] = useState({ min: '', max: '', profit: '' });
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([
      apiGet<Setting[]>('/admin/settings'),
      apiGet<Band[]>('/admin/settings/profit-bands/list'),
    ]);
    setSettings(s);
    setBands(b);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const run = async (fn: () => Promise<unknown>, key?: string) => {
    setError(null);
    try {
      await fn();
      await load();
      if (key) {
        setSaved(key);
        setTimeout(() => setSaved(null), 1500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveSetting = (key: string, raw: string) => {
    let value: unknown = raw;
    if (/^\d+$/.test(raw)) value = Number(raw);
    void run(() => apiPut(`/admin/settings/${key}`, { value }), key);
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      <h2 className="mt-6 font-semibold text-gray-700">{t('platform')}</h2>
      <div className="mt-3 space-y-2">
        {settings.map((s) => (
          <div key={s.key} className="flex items-center gap-3 rounded-xl border border-gray-200 p-3">
            <code className="flex-1 text-sm">{s.key}</code>
            <input
              className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              defaultValue={typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}
              onBlur={(e) => {
                const raw = e.target.value.replace(/^"|"$/g, '');
                if (raw !== (typeof s.value === 'string' ? s.value : JSON.stringify(s.value))) saveSetting(s.key, raw);
              }}
            />
            {saved === s.key && <span className="text-xs text-emerald-600">✓</span>}
          </div>
        ))}
      </div>

      <h2 className="mt-8 font-semibold text-gray-700">{t('bands')}</h2>
      <p className="text-xs text-gray-400">{t('bandsHint')}</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-start text-xs text-gray-400">
            <th className="p-2 text-start">{t('from')}</th>
            <th className="p-2 text-start">{t('to')}</th>
            <th className="p-2 text-start">{t('profit')}</th>
            <th className="p-2" />
          </tr>
        </thead>
        <tbody>
          {bands.map((b) => (
            <tr key={b.id} className="border-t border-gray-100">
              <td className="p-2">£{Number(b.minPriceGbp).toLocaleString()}</td>
              <td className="p-2">£{Number(b.maxPriceGbp).toLocaleString()}</td>
              <td className="p-2 font-semibold">£{Number(b.profitGbp).toLocaleString()}</td>
              <td className="p-2 text-end">
                <button
                  className="text-xs text-red-500"
                  onClick={() => run(() => api(`/admin/settings/profit-bands/${b.id}`, { method: 'DELETE' }))}
                >
                  {t('delete')}
                </button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-gray-100">
            {(['min', 'max', 'profit'] as const).map((k) => (
              <td key={k} className="p-2">
                <input
                  type="number"
                  className="w-full rounded-lg border border-gray-300 px-2 py-1.5"
                  placeholder={k}
                  value={newBand[k]}
                  onChange={(e) => setNewBand((n) => ({ ...n, [k]: e.target.value }))}
                />
              </td>
            ))}
            <td className="p-2 text-end">
              <button
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                disabled={!newBand.min || !newBand.max || !newBand.profit}
                onClick={() =>
                  run(async () => {
                    await apiPost('/admin/settings/profit-bands', {
                      minPriceGbp: Number(newBand.min),
                      maxPriceGbp: Number(newBand.max),
                      profitGbp: Number(newBand.profit),
                    });
                    setNewBand({ min: '', max: '', profit: '' });
                  })
                }
              >
                {t('add')}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
