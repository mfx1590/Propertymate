'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiDelete, apiGet, apiPost } from '../../../../../lib/api';

interface AdminUser {
  id: string;
  phone: string | null;
  email: string | null;
  status: 'active' | 'suspended' | 'banned';
  locale: string;
  createdAt: string;
  roles: { key: string; verificationStatus: string; badgeTier: string }[];
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  suspended: 'bg-amber-50 text-amber-700',
  banned: 'bg-red-50 text-red-700',
};

const GRANTABLE = ['owner', 'solo_agent', 'agency', 'agency_member', 'developer'];

/** Admin user console (Plan §6.7): search, suspend/ban with reason, role grants. */
export default function AdminUsersPage() {
  const t = useTranslations('adminUsers');
  const locale = useLocale();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (status) params.set('status', status);
    setUsers(await apiGet<AdminUser[]>(`/admin/users${params.toString() ? `?${params}` : ''}`));
  }, [q, status]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [load]);

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  /** Suspension and bans are consequential, so the reason is prompted for, not optional. */
  const setUserStatus = (u: AdminUser, next: string) =>
    run(u.id, async () => {
      let reason = '';
      if (next !== 'active') {
        reason = window.prompt(t('reasonPrompt')) ?? '';
        if (!reason.trim()) throw new ApiError(400, t('reasonRequired'));
      }
      await apiPost(`/admin/users/${u.id}/status`, { status: next, reason });
    });

  const inputCls = 'rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        <input
          className={`${inputCls} min-w-56 flex-1`}
          placeholder={t('searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('allStatuses')}</option>
          {['active', 'suspended', 'banned'].map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {!users ? (
        <p className="mt-8 text-gray-400">…</p>
      ) : users.length === 0 ? (
        <p className="mt-8 text-gray-500">{t('empty')}</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {users.map((u) => (
            <li key={u.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[u.status]}`}>
                      {t(`status.${u.status}`)}
                    </span>
                    {u.roles.map((r) => (
                      <span key={r.key} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px]">
                        {r.key}
                        {r.verificationStatus === 'verified' && ' ✓'}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 font-medium">{u.phone ?? u.email ?? u.id}</p>
                  {u.phone && u.email && <p className="text-sm text-gray-500">{u.email}</p>}
                  <p className="mt-1 text-xs text-gray-400">
                    {t('joined')} {new Date(u.createdAt).toLocaleDateString(locale)}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                {u.status !== 'active' && (
                  <button
                    className="font-medium text-emerald-700 disabled:opacity-50"
                    disabled={busy === u.id}
                    onClick={() => setUserStatus(u, 'active')}
                  >
                    {t('reactivate')}
                  </button>
                )}
                {u.status !== 'suspended' && (
                  <button
                    className="font-medium text-amber-700 disabled:opacity-50"
                    disabled={busy === u.id}
                    onClick={() => setUserStatus(u, 'suspended')}
                  >
                    {t('suspend')}
                  </button>
                )}
                {u.status !== 'banned' && (
                  <button
                    className="font-medium text-red-600 disabled:opacity-50"
                    disabled={busy === u.id}
                    onClick={() => setUserStatus(u, 'banned')}
                  >
                    {t('ban')}
                  </button>
                )}

                <select
                  className="ms-auto rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  value=""
                  disabled={busy === u.id}
                  onChange={(e) => {
                    const roleKey = e.target.value;
                    if (!roleKey) return;
                    e.target.value = '';
                    const held = u.roles.some((r) => r.key === roleKey);
                    void run(u.id, () =>
                      held
                        ? apiDelete(`/admin/users/${u.id}/roles/${roleKey}`)
                        : apiPost(`/admin/users/${u.id}/roles`, { roleKey }),
                    );
                  }}
                >
                  <option value="">{t('roleAction')}</option>
                  {GRANTABLE.map((r) => (
                    <option key={r} value={r}>
                      {u.roles.some((x) => x.key === r) ? t('revokeRole', { role: r }) : t('grantRole', { role: r })}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
