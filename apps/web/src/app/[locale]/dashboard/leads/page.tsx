'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet } from '../../../../lib/api';
import { Link } from '../../../../i18n/routing';
import {
  LEAD_STAGES,
  LEAD_STAGE_STYLES,
  formatDuration,
  type LeadInbox,
  type LeadStage,
} from '../../../../lib/leads';
import { EmptyState } from '../../../../components/EmptyState';

/**
 * Lead inbox (Plan §6.2): inquiries, viewings and offers per listing, with the
 * response-time tracking the spec asks for.
 *
 * A prospect's identity stays hidden until the §2.4 reveal gate — the lister
 * can still work the lead from here, they just cannot see who it is yet.
 */
export default function LeadsPage() {
  const t = useTranslations('leads');
  const locale = useLocale();
  const [data, setData] = useState<LeadInbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<LeadStage | 'all'>('all');
  const [propertyId, setPropertyId] = useState<string>('all');

  useEffect(() => {
    const params = new URLSearchParams();
    if (stage !== 'all') params.set('stage', stage);
    if (propertyId !== 'all') params.set('propertyId', propertyId);
    apiGet<LeadInbox>(`/leads${params.toString() ? `?${params}` : ''}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [stage, propertyId]);

  if (error) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="text-gray-400">…</p>;

  const { summary } = data;
  const selectCls = 'rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">{t('total')}</p>
          <p className="mt-1 text-2xl font-bold">{summary.total}</p>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">{t('awaitingReply')}</p>
          <p className={`mt-1 text-2xl font-bold ${summary.awaitingReply > 0 ? 'text-amber-600' : ''}`}>
            {summary.awaitingReply}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-400">{t('avgResponse')}</p>
          <p className="mt-1 text-2xl font-bold">
            {summary.avgFirstResponseSec === null ? '—' : formatDuration(summary.avgFirstResponseSec)}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <select className={selectCls} value={stage} onChange={(e) => setStage(e.target.value as LeadStage | 'all')}>
          <option value="all">{t('allStages')}</option>
          {LEAD_STAGES.map((s) => (
            <option key={s} value={s}>
              {t(`stage.${s}`)} ({summary.byStage[s]})
            </option>
          ))}
        </select>
        <select className={selectCls} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="all">{t('allListings')}</option>
          {data.listings.map((l) => (
            <option key={l.propertyId} value={l.propertyId}>
              {l.title || l.propertyId} ({l.leads})
            </option>
          ))}
        </select>
      </div>

      {data.leads.length === 0 ? (
        <EmptyState
          icon="📥"
          title={t('emptyState.title')}
          body={t('emptyState.body')}
          action={{ label: t('emptyState.action'), href: '/dashboard/listings' }}
        />
      ) : (
        <ul className="mt-6 space-y-3">
          {data.leads.map((lead) => (
            <li
              key={`${lead.propertyId}:${lead.customer?.id ?? lead.conversationId ?? lead.createdAt}`}
              className="rounded-xl border border-gray-200 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${LEAD_STAGE_STYLES[lead.stage]}`}>
                      {t(`stage.${lead.stage}`)}
                    </span>
                    {lead.unread > 0 && (
                      <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                        {t('unread', { n: lead.unread })}
                      </span>
                    )}
                    {lead.awaitingReply && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                        {t('needsReply')}
                      </span>
                    )}
                  </div>

                  <Link href={`/listing/${lead.propertyId}`} className="mt-1 block font-medium text-brand-600">
                    {lead.property.title || lead.propertyId}
                  </Link>

                  {/* §2.4: identity appears only once the gate is passed */}
                  <p className="mt-1 text-sm">
                    {lead.contactRevealed && lead.customer ? (
                      <span>{lead.customer.phone ?? lead.customer.email ?? lead.customer.id}</span>
                    ) : (
                      <span className="text-gray-400">🔒 {t('contactHidden')}</span>
                    )}
                  </p>

                  {lead.lastMessage && (
                    <p className="mt-2 line-clamp-2 text-sm text-gray-500">
                      {lead.lastMessage.fromCustomer ? '' : `${t('you')}: `}
                      {lead.lastMessage.body}
                    </p>
                  )}
                </div>

                <div className="text-end text-xs text-gray-400">
                  <p>{new Date(lead.lastActivityAt).toLocaleDateString(locale)}</p>
                  {lead.firstResponseSec !== null && (
                    <p className="mt-1">
                      {t('respondedIn')} {formatDuration(lead.firstResponseSec)}
                    </p>
                  )}
                </div>
              </div>

              {(lead.viewings.length > 0 || lead.offers.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {lead.viewings.map((v) => (
                    <span key={v.id} className="rounded-full bg-gray-100 px-2 py-1">
                      {t('viewing')} · {new Date(v.scheduledAt).toLocaleDateString(locale)} · {t(`viewingStatus.${v.status}`)}
                    </span>
                  ))}
                  {lead.offers.map((o) => (
                    <span key={o.id} className="rounded-full bg-gray-100 px-2 py-1">
                      {t('offer')} · {new Intl.NumberFormat(locale, { style: 'currency', currency: o.currency, maximumFractionDigits: 0 }).format(o.amount)} · {t(`offerStatus.${o.status}`)}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                {lead.conversationId && (
                  <Link href="/dashboard/messages" className="font-medium text-brand-600">
                    {t('openThread')} →
                  </Link>
                )}
                {lead.dealId && (
                  <Link href={`/dashboard/deals/${lead.dealId}`} className="font-medium text-brand-600">
                    {t('openDeal')} →
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
