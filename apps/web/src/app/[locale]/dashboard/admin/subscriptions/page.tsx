'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../../lib/api';

interface Plan {
  key: string;
  name: string;
  roleKey: string;
}
interface Sub {
  id: string;
  userId: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  plan: { key: string; name: string };
}

export default function AdminSubscriptionsPage() {
  const t = useTranslations('adminSubs');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [form, setForm] = useState({ identifier: '', planKey: '', months: '12' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([apiGet<Plan[]>('/plans'), apiGet<Sub[]>('/admin/subscriptions')]);
    setPlans(p);
    setSubs(s);
    setForm((f) => ({ ...f, planKey: f.planKey || p[0]?.key || '' }));
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const grant = async () => {
    setError(null);
    setMsg(null);
    try {
      await apiPost('/admin/subscriptions/grant', {
        identifier: form.identifier,
        planKey: form.planKey,
        months: Number(form.months) || undefined,
      });
      setMsg(t('granted'));
      setForm((f) => ({ ...f, identifier: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const revoke = async (id: string) => {
    await apiPost(`/admin/subscriptions/${id}/revoke`);
    await load();
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-4 flex flex-wrap gap-2 rounded-xl border border-gray-200 p-4">
        <input
          className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder={t('identifier')}
          value={form.identifier}
          onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
        />
        <select
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          value={form.planKey}
          onChange={(e) => setForm((f) => ({ ...f, planKey: e.target.value }))}
        >
          {plans.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name} ({p.roleKey})
            </option>
          ))}
        </select>
        <input
          type="number"
          className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder={t('months')}
          value={form.months}
          onChange={(e) => setForm((f) => ({ ...f, months: e.target.value }))}
        />
        <button
          onClick={grant}
          disabled={!form.identifier || !form.planKey}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t('grant')}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-600">{msg}</p>}
      {error && <p className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <ul className="mt-6 space-y-2">
        {subs.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-3 text-sm">
            <span>
              <b>{s.plan.name}</b> · {s.status} · {new Date(s.startsAt).toLocaleDateString()}
              {s.endsAt && ` → ${new Date(s.endsAt).toLocaleDateString()}`}
              <span className="ms-2 text-xs text-gray-400">{s.userId}</span>
            </span>
            {s.status === 'active' && (
              <button className="text-xs text-red-500" onClick={() => revoke(s.id)}>
                {t('revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
