'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost, apiUpload } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import type { RequirementConfig } from '../../../lib/types';

const STATUS_STYLES: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  unverified: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-50 text-red-700',
};

interface UploadedDoc {
  id: string;
  documentType: string;
  status: string;
  rejectReasonCode: string | null;
  rejectNote: string | null;
}

interface AppNotification {
  id: string;
  templateKey: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export default function DashboardOverview() {
  const t = useTranslations('dashboard');
  const locale = useLocale();
  const { me, refreshMe } = useAuth();
  const [requirements, setRequirements] = useState<Record<string, RequirementConfig[]>>({});
  const [docs, setDocs] = useState<Record<string, UploadedDoc[]>>({});
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [busy, setBusy] = useState(false);

  const reviewableKeys = (me?.userRoles ?? [])
    .filter((ur) => ur.verificationStatus === 'pending' || ur.verificationStatus === 'rejected')
    .map((ur) => ur.role.key);
  const reviewableStr = reviewableKeys.join(',');

  const loadDocs = useCallback(async (keys: string[]) => {
    const entries = await Promise.all(
      keys.map(async (key) => {
        const [reqs, uploaded] = await Promise.all([
          apiGet<RequirementConfig[]>(`/roles/${key}/requirements`),
          apiGet<UploadedDoc[]>(`/users/me/profile/${key}/documents`),
        ]);
        return [key, reqs, uploaded] as const;
      }),
    );
    setRequirements(Object.fromEntries(entries.map(([k, r]) => [k, r])));
    setDocs(Object.fromEntries(entries.map(([k, , d]) => [k, d])));
  }, []);

  useEffect(() => {
    if (reviewableStr) void loadDocs(reviewableStr.split(','));
  }, [reviewableStr, loadDocs]);

  useEffect(() => {
    void apiGet<AppNotification[]>('/users/me/notifications').then(setNotifications).catch(() => undefined);
  }, []);

  if (!me) return null;

  const upload = async (roleKey: string, documentType: string, file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', documentType);
      await apiUpload(`/users/me/profile/${roleKey}/documents`, fd);
      await loadDocs(reviewableStr.split(','));
      await refreshMe();
    } finally {
      setBusy(false);
    }
  };

  const notifText = (n: AppNotification) => {
    const title = (n.payload?.title as string) ?? (n.payload?.roleKey as string) ?? '';
    try {
      return t(`notifications.${n.templateKey}`, { title });
    } catch {
      return n.templateKey;
    }
  };

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('overview.title')}</h1>

      {/* notifications */}
      {notifications.length > 0 && (
        <section className="mt-6 rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-700">
              {t('overview.notifications')}
              {unread > 0 && (
                <span className="ms-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">{unread}</span>
              )}
            </h2>
            {unread > 0 && (
              <button
                className="text-sm text-gray-400"
                onClick={() =>
                  apiPost('/users/me/notifications/read-all').then(() =>
                    setNotifications((ns) => ns.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))),
                  )
                }
              >
                {t('overview.markAllRead')}
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {notifications.slice(0, 8).map((n) => (
              <li key={n.id} className={n.readAt ? 'text-gray-400' : 'font-medium text-gray-700'}>
                • {notifText(n)}{' '}
                <span className="text-xs text-gray-300">{new Date(n.createdAt).toLocaleString(locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* roles held */}
      <section className="mt-6">
        <h2 className="font-semibold text-gray-700">{t('overview.yourRoles')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {me.userRoles.map((ur) => (
            <div key={ur.role.key} className="rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium">{t(`roles.${ur.role.key}`)}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[ur.verificationStatus] ?? STATUS_STYLES.unverified}`}>
                  {t(`status.${ur.verificationStatus}`)}
                </span>
              </div>
              {ur.verificationStatus === 'pending' && (
                <p className="mt-2 text-xs text-gray-500">{t('overview.pendingHint')}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* document upload for roles under review */}
      {reviewableKeys.map((key) => (
        <section key={key} className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-semibold text-amber-900">
            {t('overview.requirementsTitle', { role: t(`roles.${key}`) })}
          </h3>
          <div className="mt-3 space-y-2">
            {(requirements[key] ?? []).map((req) => {
              const uploaded = (docs[key] ?? []).filter((d) => d.documentType === req.documentType);
              const latest = uploaded[0];
              return (
                <div key={req.documentType} className="flex items-center justify-between gap-3 rounded-lg bg-white p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {req.titleI18n[locale] ?? req.titleI18n.en}
                      {req.isRequired && <span className="text-red-500"> *</span>}
                    </p>
                    {latest?.status === 'rejected' && (
                      <p className="text-xs text-red-600">
                        ✕ {t(`reasons.${latest.rejectReasonCode ?? 'other'}`)}
                        {latest.rejectNote && ` — ${latest.rejectNote}`}
                      </p>
                    )}
                    {latest?.status === 'approved' && <p className="text-xs text-emerald-600">✓ {t('overview.docApproved')}</p>}
                    {latest?.status === 'pending' && <p className="text-xs text-amber-600">⏳ {t('overview.docPending')}</p>}
                  </div>
                  <label className="shrink-0 cursor-pointer rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      className="hidden"
                      disabled={busy}
                      onChange={(e) => e.target.files?.[0] && upload(key, req.documentType, e.target.files[0])}
                    />
                    {latest ? t('overview.reupload') : t('overview.upload')}
                  </label>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
