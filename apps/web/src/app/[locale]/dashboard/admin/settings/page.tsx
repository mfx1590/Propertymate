'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { api, apiGet, apiPost, apiPut } from '../../../../../lib/api';

/**
 * A setting as the API describes it: the declared ones carry their type and
 * bounds so this screen can render the right control, and the undeclared ones
 * carry the reason nothing reads them. The screen used to render the raw
 * `platform_settings` table into free-text boxes, which meant a dead key looked
 * exactly like a live one and typing `false` into a boolean stored the *string*
 * "false" — truthy, so switching offers off switched them on.
 */
interface DeclaredSetting {
  key: string;
  value: boolean | number | string;
  declared: true;
  source: 'default' | 'stored';
  invalid: string | null;
  type: 'boolean' | 'number' | 'enum';
  default: boolean | number | string;
  description: string;
  readBy: string;
  seamNote: string | null;
  min?: number;
  max?: number;
  integer?: boolean;
  unit?: string | null;
  options?: string[];
}
interface UnknownSetting {
  key: string;
  value: unknown;
  declared: false;
  source: 'stored';
  reason: string;
}
type Setting = DeclaredSetting | UnknownSetting;

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

  /** `null` resets to the declared default rather than storing a copy of it. */
  const saveSetting = (key: string, value: unknown) =>
    run(() => apiPut(`/admin/settings/${key}`, { value }), key);

  const declared = settings.filter((s): s is DeclaredSetting => s.declared);
  const unknown = settings.filter((s): s is UnknownSetting => !s.declared);
  const groups = [...new Set(declared.map((s) => s.key.split('.')[0]))];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      <h2 className="mt-6 font-semibold text-gray-700">{t('platform')}</h2>
      <p className="text-xs text-gray-400">{t('platformHint')}</p>

      {groups.map((group) => (
        <section key={group} className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{group}</h3>
          <div className="mt-2 space-y-2">
            {declared
              .filter((s) => s.key.split('.')[0] === group)
              .map((s) => (
                <div key={s.key} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <code className="text-sm font-medium">{s.key}</code>
                      <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {t('readBy')}: {s.readBy}
                      </p>
                      {s.seamNote && (
                        <p className="mt-1 rounded-md bg-amber-50 p-2 text-[11px] text-amber-800">
                          {t('seam')}: {s.seamNote}
                        </p>
                      )}
                      {s.invalid && (
                        <p className="mt-1 rounded-md bg-red-50 p-2 text-[11px] text-red-700">
                          {t('invalidStored')}: {s.invalid}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <SettingControl setting={s} onChange={(v) => void saveSetting(s.key, v)} />
                      <div className="flex items-center gap-2 text-[11px]">
                        {saved === s.key && <span className="text-emerald-600">✓</span>}
                        {s.source === 'default' ? (
                          <span className="text-gray-400">{t('isDefault')}</span>
                        ) : (
                          <button
                            className="text-brand-600 hover:underline"
                            onClick={() => void saveSetting(s.key, null)}
                          >
                            {t('resetToDefault', { value: String(s.default) })}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}

      {unknown.length > 0 && (
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-red-500">{t('unrecognised')}</h3>
          <p className="text-xs text-gray-400">{t('unrecognisedHint')}</p>
          <div className="mt-2 space-y-2">
            {unknown.map((s) => (
              <div key={s.key} className="rounded-xl border border-red-200 bg-red-50/40 p-3">
                <code className="text-sm line-through">{s.key}</code>
                <span className="ms-2 text-xs text-gray-500">{JSON.stringify(s.value)}</span>
                <p className="mt-1 text-[11px] text-red-700">{s.reason}</p>
              </div>
            ))}
          </div>
        </section>
      )}

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

/**
 * The control follows the declared type, so a boolean cannot be typed into and
 * a number cannot be handed a word. The API validates regardless — this screen
 * is not the only way in — but a text box that accepts anything and a rule that
 * rejects most of it is a bad way to learn what a setting takes.
 */
function SettingControl({
  setting,
  onChange,
}: {
  setting: DeclaredSetting;
  onChange: (value: boolean | number | string) => void;
}) {
  const t = useTranslations('adminSettings');

  if (setting.type === 'boolean') {
    const on = setting.value === true;
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={setting.key}
        onClick={() => onChange(!on)}
        className={`flex w-24 items-center justify-between rounded-full px-3 py-1 text-xs font-medium ${
          on ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'
        }`}
      >
        <span>{on ? t('on') : t('off')}</span>
        <span className={`h-3 w-3 rounded-full ${on ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      </button>
    );
  }

  if (setting.type === 'enum') {
    return (
      <select
        aria-label={setting.key}
        className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        value={String(setting.value)}
        onChange={(e) => onChange(e.target.value)}
      >
        {(setting.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        aria-label={setting.key}
        className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        min={setting.min}
        max={setting.max}
        step={setting.integer ? 1 : 0.1}
        defaultValue={String(setting.value)}
        onBlur={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n) && n !== setting.value) onChange(n);
        }}
      />
      {setting.unit && <span className="text-xs text-gray-400">{setting.unit}</span>}
    </div>
  );
}
