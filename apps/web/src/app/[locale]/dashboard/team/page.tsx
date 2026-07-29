'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { Link } from '../../../../i18n/routing';
import { MEMBER_STATUS_STYLES, type OrgRole, type TeamMember } from '../../../../lib/team';

export default function TeamPage() {
  const t = useTranslations('team');
  const locale = useLocale();
  const { me } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ phone: '', bio: '', orgRole: 'member' as OrgRole });

  const agencyUserId = me?.userRoles.some((r) => r.role.key === 'agency') ? me.id : null;

  const load = () => apiGet<TeamMember[]>('/agency/members').then(setMembers);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load().catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  const addMember = () =>
    run(async () => {
      await apiPost('/agency/members', {
        phone: form.phone.trim(),
        bio: form.bio.trim() || undefined,
        orgRole: form.orgRole,
      });
      setForm({ phone: '', bio: '', orgRole: 'member' });
    });

  const setRole = (userId: string, orgRole: OrgRole) =>
    run(() => apiPut(`/agency/members/${userId}`, { orgRole }));

  const deactivate = (userId: string) =>
    run(async () => {
      if (!window.confirm(t('confirmRemove'))) return;
      await apiDelete(`/agency/members/${userId}`);
    });

  const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm';

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>
        </div>
        {agencyUserId && (
          <Link href={`/agencies/${agencyUserId}`} className="text-sm font-medium text-brand-600">
            {t('viewPublic')} →
          </Link>
        )}
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {/* add member */}
      <div className="mt-6 rounded-xl border border-gray-200 p-4">
        <span className="text-sm font-medium text-gray-700">{t('add')}</span>
        <p className="mt-1 text-xs text-gray-400">{t('addHint')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-xs text-gray-500">{t('phone')}</span>
            <input
              className={inputCls}
              value={form.phone}
              placeholder="+90 533 123 45 67"
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-gray-500">{t('bio')}</span>
            <input
              className={inputCls}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-500">{t('orgRole')}</span>
            <select
              className={inputCls}
              value={form.orgRole}
              onChange={(e) => setForm({ ...form, orgRole: e.target.value as OrgRole })}
            >
              <option value="member">{t('roleMember')}</option>
              <option value="org_admin">{t('roleOrgAdmin')}</option>
            </select>
          </label>
        </div>
        <button
          className="mt-3 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={busy || !form.phone.trim()}
          onClick={addMember}
        >
          {busy ? t('adding') : t('addMember')}
        </button>
      </div>

      {!members ? (
        <p className="mt-8 text-gray-400">…</p>
      ) : members.length === 0 ? (
        <p className="mt-8 text-gray-500">{t('empty')}</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {members.map((m) => (
            <li key={m.userId} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${MEMBER_STATUS_STYLES[m.status]}`}
                    >
                      {t(`status.${m.status}`)}
                    </span>
                    {m.orgRole === 'org_admin' && (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                        {t('roleOrgAdmin')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-medium">{m.phone ?? m.email ?? m.userId}</p>
                  {m.bio && <p className="text-sm text-gray-500">{m.bio}</p>}
                  <p className="mt-1 text-xs text-gray-400">
                    {t('joined')} {new Date(m.joinedAt).toLocaleDateString(locale)}
                  </p>
                </div>
                <div className="text-end text-sm">
                  <p>
                    <span className="font-semibold">{m.salesClosed}</span>{' '}
                    <span className="text-gray-400">{t('salesClosed')}</span>
                  </p>
                  <p>
                    <span className="font-semibold">{m.rentalsClosed}</span>{' '}
                    <span className="text-gray-400">{t('rentalsClosed')}</span>
                  </p>
                </div>
              </div>

              {m.status === 'active' && (
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <button
                    className="font-medium text-brand-600 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setRole(m.userId, m.orgRole === 'org_admin' ? 'member' : 'org_admin')}
                  >
                    {m.orgRole === 'org_admin' ? t('demote') : t('promote')}
                  </button>
                  <button
                    className="text-red-600 disabled:opacity-50"
                    disabled={busy}
                    onClick={() => deactivate(m.userId)}
                  >
                    {t('remove')}
                  </button>
                </div>
              )}
              {m.status === 'deactivated' && (
                <p className="mt-3 text-xs text-gray-400">{t('reactivateHint')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
