'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet } from '../../../../lib/api';

interface ReferralOverview {
  code: string;
  referrals: { id: string; status: 'pending' | 'qualified' | 'expired'; createdAt: string; qualifiedAt: string | null }[];
  summary: { invited: number; qualified: number; creditsAvailable: number; creditsUsed: number };
  credits: {
    id: string;
    status: 'available' | 'used' | 'expired';
    source: string;
    expiresAt: string | null;
    usedOnPropertyId: string | null;
    usedAt: string | null;
    createdAt: string;
  }[];
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  qualified: 'bg-emerald-50 text-emerald-700',
  expired: 'bg-gray-100 text-gray-500',
  available: 'bg-emerald-50 text-emerald-700',
  used: 'bg-gray-100 text-gray-500',
};

/**
 * Referrals (Plan §8). Invitees are shown as counts and statuses only — who
 * accepted an invite is not the inviter's to see.
 */
export default function ReferralsPage() {
  const t = useTranslations('referrals');
  const locale = useLocale();
  const [data, setData] = useState<ReferralOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiGet<ReferralOverview>('/users/me/referrals')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-gray-400">…</p>;

  const inviteUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/${locale}/auth?ref=${data.code}`;

  const copy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-6 rounded-xl border border-gray-200 p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">{t('yourCode')}</p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-widest">{data.code}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            readOnly
            className="min-w-64 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            value={inviteUrl}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
            onClick={copy}
          >
            {copied ? t('copied') : t('copyLink')}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">{t('howItWorks')}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[
          [t('invited'), data.summary.invited],
          [t('qualified'), data.summary.qualified],
          [t('creditsAvailable'), data.summary.creditsAvailable],
          [t('creditsUsed'), data.summary.creditsUsed],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-gray-200 p-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t('invites')}</h2>
        {data.referrals.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">{t('noInvites')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.referrals.map((r, i) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                {/* deliberately anonymous — see the API comment */}
                <span className="text-gray-500">{t('inviteN', { n: data.referrals.length - i })}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[r.status]}`}>
                  {t(`status.${r.status}`)}
                </span>
                <span className="ms-auto text-xs text-gray-400">
                  {new Date(r.qualifiedAt ?? r.createdAt).toLocaleDateString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{t('credits')}</h2>
        <p className="mt-1 text-xs text-gray-400">{t('creditsHint')}</p>
        {data.credits.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">{t('noCredits')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.credits.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[c.status]}`}>
                  {t(`status.${c.status}`)}
                </span>
                <span>{t('featuredCredit')}</span>
                <span className="ms-auto text-xs text-gray-400">
                  {c.status === 'available' && c.expiresAt
                    ? t('expires', { date: new Date(c.expiresAt).toLocaleDateString(locale) })
                    : c.usedAt
                      ? t('usedOn', { date: new Date(c.usedAt).toLocaleDateString(locale) })
                      : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
