'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiGet, apiPut } from '../../../../../lib/api';

/** Editable fields per role — mirrors the API's per-role whitelist. */
const FIELDS: Record<string, { name: string; textarea?: boolean }[]> = {
  solo_agent: [{ name: 'licenseNo' }, { name: 'bio', textarea: true }],
  agency: [
    { name: 'companyName' },
    { name: 'regNo' },
    { name: 'taxNo' },
    { name: 'address' },
    { name: 'about', textarea: true },
  ],
  developer: [
    { name: 'companyName' },
    { name: 'regNo' },
    { name: 'taxNo' },
    { name: 'about', textarea: true },
  ],
};

export default function ProfileEditPage() {
  const t = useTranslations('dashboard');
  const { roleKey } = useParams<{ roleKey: string }>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  const fields = FIELDS[roleKey] ?? [];

  useEffect(() => {
    apiGet<Record<string, unknown>>(`/users/me/profile/${roleKey}`)
      .then((profile) => {
        const initial: Record<string, string> = {};
        for (const f of FIELDS[roleKey] ?? []) {
          initial[f.name] = typeof profile[f.name] === 'string' ? (profile[f.name] as string) : '';
        }
        setValues(initial);
        setState('ready');
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setState('error');
      });
  }, [roleKey]);

  const save = async () => {
    setState('saving');
    setError(null);
    try {
      await apiPut(`/users/me/profile/${roleKey}`, values);
      setState('saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('ready');
    }
  };

  if (fields.length === 0) {
    return <p className="text-gray-500">{t('profile.notEditable')}</p>;
  }
  if (state === 'loading') return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold">
        {t('profile.title', { role: t(`roles.${roleKey}`) })}
      </h1>
      <div className="mt-6 space-y-4">
        {fields.map((f) => (
          <label key={f.name} className="block">
            <span className="text-sm font-medium text-gray-700">{t(`profile.fields.${f.name}`)}</span>
            {f.textarea ? (
              <textarea
                className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3"
                rows={4}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            ) : (
              <input
                className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-3"
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
          </label>
        ))}
        <button
          className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white disabled:opacity-50"
          disabled={state === 'saving'}
          onClick={save}
        >
          {state === 'saving' ? '…' : t('profile.save')}
        </button>
        {state === 'saved' && <span className="ms-3 text-sm text-emerald-600">{t('profile.saved')}</span>}
        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
