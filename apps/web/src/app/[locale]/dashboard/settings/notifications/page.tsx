'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiDelete, apiGet, apiPut } from '../../../../../lib/api';
import {
  ALL_CHANNELS,
  DELIVERY_STATUS_STYLES,
  type DeliveryRow,
  type NotificationChannel,
  type NotificationPreferences,
} from '../../../../../lib/notifications';

/**
 * Channel preferences + delivery log (Plan §6.6).
 * in_app is rendered as a locked control rather than hidden: the user should
 * see that the in-app record always exists, not wonder where it went.
 */
export default function NotificationSettingsPage() {
  const t = useTranslations('notificationSettings');
  const locale = useLocale();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [log, setLog] = useState<DeliveryRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [p, d] = await Promise.all([
      apiGet<NotificationPreferences>('/users/me/notification-preferences'),
      apiGet<DeliveryRow[]>('/users/me/notification-deliveries'),
    ]);
    setPrefs(p);
    setLog(d);
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (category: string, channel: NotificationChannel, on: boolean) => {
    const current = prefs?.categories.find((c) => c.category === category)?.channels ?? [];
    const next = on ? [...current, channel] : current.filter((c) => c !== channel);
    return run(`${category}:${channel}`, () =>
      apiPut(`/users/me/notification-preferences/${category}`, { channels: next }),
    );
  };

  const reset = (category: string) =>
    run(`${category}:reset`, () => apiDelete(`/users/me/notification-preferences/${category}`));

  if (error && !prefs) {
    return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  }
  if (!prefs) return <p className="text-gray-400">…</p>;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="py-2 text-start font-medium">{t('categoryColumn')}</th>
              {ALL_CHANNELS.map((ch) => (
                <th key={ch} className="px-2 py-2 text-center font-medium">
                  {t(`channel.${ch}`)}
                </th>
              ))}
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {prefs.categories.map((c) => (
              <tr key={c.category} className="border-t border-gray-100">
                <td className="py-2.5">
                  <span className="font-medium">{t(`category.${c.category}`)}</span>
                  <p className="text-xs text-gray-400">{t(`hint.${c.category}`)}</p>
                </td>
                {ALL_CHANNELS.map((ch) => {
                  const locked = prefs.mandatory.includes(ch);
                  return (
                    <td key={ch} className="px-2 py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand-600 disabled:opacity-40"
                        checked={c.channels.includes(ch)}
                        disabled={locked || busy !== null}
                        title={locked ? t('alwaysOn') : undefined}
                        aria-label={`${t(`category.${c.category}`)} — ${t(`channel.${ch}`)}`}
                        onChange={(e) => toggle(c.category, ch, e.target.checked)}
                      />
                    </td>
                  );
                })}
                <td className="py-2.5 text-end">
                  {!c.isDefault && (
                    <button
                      className="text-xs font-medium text-brand-600 disabled:opacity-50"
                      disabled={busy !== null}
                      onClick={() => reset(c.category)}
                    >
                      {t('reset')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-400">{t('alwaysOnHint')}</p>

      {/* delivery log — answers "was I actually emailed?" without asking support */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">{t('deliveries')}</h2>
        <p className="mt-1 text-xs text-gray-400">{t('deliveriesHint')}</p>
        {!log || log.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">{t('noDeliveries')}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {log.slice(0, 25).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${DELIVERY_STATUS_STYLES[d.status]}`}>
                  {t(`status.${d.status}`)}
                </span>
                <span className="text-xs uppercase tracking-wide text-gray-400">
                  {t(`channel.${d.channel}`)}
                </span>
                <span className="text-sm">{d.templateKey}</span>
                <span className="ms-auto text-xs text-gray-400">
                  {new Date(d.createdAt).toLocaleString(locale)}
                </span>
                {d.error && <p className="w-full text-xs text-gray-400">{d.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
