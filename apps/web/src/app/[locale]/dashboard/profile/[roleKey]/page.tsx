'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiGet, apiPut } from '../../../../../lib/api';

interface Field {
  name: string;
  textarea?: boolean;
  /** A fixed set of values — rendered as a select, sent as the raw key. */
  options?: readonly string[];
  /** An array on the API side; edited here as a comma-separated line. */
  list?: boolean;
}

/** Editable fields per role — mirrors the API's per-role whitelist. */
const FIELDS: Record<string, Field[]> = {
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
  // The two list fields are what the public directory filters on, so they are
  // not optional extras — a lawyer who fills in neither is findable by everyone
  // and specific to no one.
  lawyer: [
    { name: 'firmName' },
    { name: 'barNo' },
    { name: 'bio', textarea: true },
    { name: 'regions', list: true },
    { name: 'languages', list: true },
    { name: 'feeModel', options: ['fixed', 'hourly', 'percentage'] },
    { name: 'feeNote' },
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
          const raw = profile[f.name];
          initial[f.name] = f.list
            ? (Array.isArray(raw) ? (raw as string[]).join(', ') : '')
            : typeof raw === 'string'
              ? raw
              : '';
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
      // List fields go back as arrays. Splitting on save rather than on every
      // keystroke lets someone type "kyrenia, " without the empty tail becoming
      // a region nothing matches.
      const payload: Record<string, unknown> = {};
      for (const f of fields) {
        const raw = values[f.name] ?? '';
        payload[f.name] = f.list
          ? raw.split(',').map((s) => s.trim()).filter(Boolean)
          : raw;
      }
      await apiPut(`/users/me/profile/${roleKey}`, payload);
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

  const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-4 py-3';

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
                className={inputCls}
                rows={4}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            ) : f.options ? (
              <select
                className={inputCls}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              >
                <option value="">{t('profile.noChoice')}</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{t(`profile.feeModels.${o}`)}</option>
                ))}
              </select>
            ) : (
              <input
                className={inputCls}
                value={values[f.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
            {f.list && <span className="mt-1 block text-xs text-gray-400">{t('profile.listHint')}</span>}
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
