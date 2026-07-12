'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../../../lib/api';
import { useRouter } from '../../../../../../i18n/routing';

interface AgentCard {
  userId: string;
  type: string;
  name: string;
  bio: string | null;
  regions: string[];
  dealCount: number;
  ratingAvg: number | null;
}

export default function FindAgentPage() {
  const t = useTranslations('findAgent');
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [agents, setAgents] = useState<AgentCard[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [term, setTerm] = useState(3);
  const [maxAgents, setMaxAgents] = useState(3);
  const [termBounds, setTermBounds] = useState({ min: 1, max: 6 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      apiGet<AgentCard[]>('/agents/directory'),
      apiGet<{ maxAgents: number; minTermMonths: number; maxTermMonths: number }>('/settings/public'),
    ]).then(([dir, s]) => {
      setAgents(dir);
      setMaxAgents(s.maxAgents);
      setTermBounds({ min: s.minTermMonths, max: s.maxTermMonths });
    });
  }, []);

  const toggle = (userId: string) =>
    setSelected((sel) =>
      sel.includes(userId) ? sel.filter((x) => x !== userId) : sel.length < maxAgents ? [...sel, userId] : sel,
    );

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/properties/${id}/assignments`, { agentUserIds: selected, termMonths: term });
      router.push('/dashboard/listings');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle', { max: maxAgents })}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {agents.map((a) => {
          const active = selected.includes(a.userId);
          return (
            <button
              key={a.userId}
              onClick={() => toggle(a.userId)}
              className={`rounded-xl border-2 p-4 text-start ${active ? 'border-brand-600 bg-brand-50' : 'border-gray-200'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{a.name}</span>
                <span className="text-xs text-gray-400">{a.type === 'agency' ? t('agency') : t('agent')}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-gray-500">{a.bio ?? '—'}</p>
              <p className="mt-2 text-xs text-gray-400">
                {t('deals')}: {a.dealCount}
                {a.ratingAvg != null && ` · ★ ${a.ratingAvg.toFixed(1)}`}
              </p>
            </button>
          );
        })}
        {agents.length === 0 && <p className="text-gray-500">{t('noAgents')}</p>}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <label className="text-sm font-medium">{t('term')}</label>
        <select
          className="rounded-lg border border-gray-300 px-3 py-2"
          value={term}
          onChange={(e) => setTerm(Number(e.target.value))}
        >
          {Array.from({ length: termBounds.max - termBounds.min + 1 }, (_, i) => termBounds.min + i).map((m) => (
            <option key={m} value={m}>
              {m} {t('months')}
            </option>
          ))}
        </select>
        <button
          onClick={send}
          disabled={busy || selected.length === 0}
          className="rounded-lg bg-brand-600 px-6 py-2.5 font-medium text-white disabled:opacity-50"
        >
          {t('send', { count: selected.length })}
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-400">{t('privacyNote')}</p>
      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
