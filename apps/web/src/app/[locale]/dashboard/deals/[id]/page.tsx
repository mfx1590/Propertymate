'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost, apiUpload } from '../../../../../lib/api';
import { Link } from '../../../../../i18n/routing';
import { fmtGbp, fmtMoney } from '../../../../../lib/listings';

interface StageDef {
  key: string;
  titleI18n: Record<string, string>;
  requiredDocuments: string[];
  completesBy: string;
  skippable?: boolean;
}
interface DealStage {
  stageKey: string;
  status: string;
  completedAt: string | null;
}
interface DealEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}
interface DealDetail {
  id: string;
  kind: string;
  status: string;
  currentStageKey: string;
  myPartyRole: string | null;
  snapshot: { priceAgreed: string; currency: string; commissionSplit: Record<string, number | null>; propertySnapshot: Record<string, unknown> } | null;
  parties: { userId: string; partyRole: string }[];
  stages: DealStage[];
  stageDefs: StageDef[];
  events: DealEvent[];
  documents: { document: { id: string; documentType: string } }[];
  property: { id: string } | null;
}
interface Rateable {
  userId: string;
  alreadyRated: boolean;
}

const RATING_TAGS = ['responsive', 'honest', 'smooth_process', 'knowledgeable', 'punctual', 'professional'];

export default function DealRoomPage() {
  const t = useTranslations('deals');
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [rateable, setRateable] = useState<Rateable[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await apiGet<DealDetail>(`/deals/${id}`);
    setDeal(d);
    if (d.status === 'completed') {
      setRateable(await apiGet<Rateable[]>(`/deals/${id}/rateable`).catch(() => []));
    }
  }, [id]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !deal) return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!deal) return <p className="text-gray-400">…</p>;

  const curDef = deal.stageDefs.find((s) => s.key === deal.currentStageKey);
  const attachedTypes = new Set(deal.documents.map((d) => d.document.documentType));
  const missingDocs = (curDef?.requiredDocuments ?? []).filter((d) => !attachedTypes.has(d));
  const stageStatus = (key: string) => deal.stages.find((s) => s.stageKey === key)?.status ?? 'pending';

  const uploadDoc = (documentType: string, file: File) =>
    run(async () => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', documentType);
      await apiUpload(`/deals/${id}/documents`, fd);
    });

  const snap = deal.snapshot;
  const cs = snap?.commissionSplit ?? {};

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('room.title')}</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${deal.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
          {t(`status.${deal.status}`)}
        </span>
      </div>
      <p className="mt-1 text-gray-500">
        {String(snap?.propertySnapshot?.title ?? '')} · {t(`kind.${deal.kind}`)}
      </p>

      {/* frozen snapshot */}
      {snap && (
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-gray-200 p-4 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-gray-400">{t('room.priceAgreed')}</dt><dd className="font-semibold">{fmtMoney(Number(snap.priceAgreed), snap.currency)}</dd></div>
          {cs.ownerAskGbp != null && <div><dt className="text-xs text-gray-400">{t('room.ownerAsk')}</dt><dd className="font-medium">{fmtGbp(Number(cs.ownerAskGbp))}</dd></div>}
          {cs.platformProfitGbp != null && <div><dt className="text-xs text-gray-400">{t('room.platformFee')}</dt><dd className="font-medium">{fmtGbp(Number(cs.platformProfitGbp))}</dd></div>}
          {cs.agentCommissionGbp != null && <div><dt className="text-xs text-gray-400">{t('room.agentCommission')}</dt><dd className="font-medium">{fmtGbp(Number(cs.agentCommissionGbp))}</dd></div>}
        </div>
      )}

      {/* journey tracker */}
      <h2 className="mt-8 font-semibold text-gray-700">{t('room.journey')}</h2>
      <ol className="mt-3 space-y-2">
        {deal.stageDefs.map((s) => {
          const st = stageStatus(s.key);
          const isCurrent = s.key === deal.currentStageKey && deal.status === 'active';
          const dot =
            st === 'completed' ? 'bg-emerald-500' : st === 'skipped' ? 'bg-gray-300' : isCurrent ? 'bg-brand-600' : 'bg-gray-200';
          return (
            <li key={s.key} className={`flex gap-3 rounded-xl border p-3 ${isCurrent ? 'border-brand-500 bg-brand-50/40' : 'border-gray-100'}`}>
              <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${st === 'completed' ? 'text-gray-500 line-through' : ''}`}>
                    {s.titleI18n[locale] ?? s.titleI18n.en}
                  </span>
                  {st === 'skipped' && <span className="text-xs text-gray-400">({t('room.skipped')})</span>}
                  {st === 'completed' && <span className="text-xs text-emerald-600">✓</span>}
                </div>
                {isCurrent && (
                  <>
                    <p className="mt-1 text-sm text-gray-600">{t(`next.${s.key}`)}</p>

                    {/* required document upload for this stage */}
                    {(s.requiredDocuments ?? []).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {s.requiredDocuments.map((dt) => (
                          <div key={dt} className="flex items-center gap-2 text-sm">
                            {attachedTypes.has(dt) ? (
                              <span className="text-emerald-600">✓ {t(`docTypes.${dt}`)}</span>
                            ) : (
                              <>
                                <span className="text-amber-600">{t(`docTypes.${dt}`)} —</span>
                                <label className="cursor-pointer rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white">
                                  <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDoc(dt, e.target.files[0])} />
                                  {t('room.upload')}
                                </label>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* stage actions */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        className="min-w-40 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                        placeholder={t('room.notePlaceholder')}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <button
                        disabled={busy || missingDocs.length > 0}
                        onClick={() => run(async () => { await apiPost(`/deals/${id}/advance`, { note: note || undefined }); setNote(''); })}
                        className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {s.key === (deal.kind === 'rental' ? 'move_in_checklist' : 'completion') ? t('room.complete') : t('room.advance')}
                      </button>
                      {s.skippable && (
                        <button disabled={busy} onClick={() => run(() => apiPost(`/deals/${id}/skip`))} className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm disabled:opacity-50">
                          {t('room.skip')}
                        </button>
                      )}
                    </div>
                    {missingDocs.length > 0 && <p className="mt-1 text-xs text-amber-600">{t('room.attachFirst')}</p>}
                    <p className="mt-1 text-[11px] text-gray-400">{t('room.completesBy', { who: t(`completesBy.${s.completesBy}`) })}</p>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* ratings (post-completion) */}
      {deal.status === 'completed' && rateable.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold text-gray-700">{t('room.rate')}</h2>
          <p className="text-xs text-gray-400">{t('room.rateHint')}</p>
          <div className="mt-3 space-y-3">
            {rateable.map((r) => (
              <RatingForm key={r.userId} dealId={id} rateeId={r.userId} alreadyRated={r.alreadyRated} onDone={load} />
            ))}
          </div>
        </section>
      )}

      {/* immutable timeline */}
      <h2 className="mt-8 font-semibold text-gray-700">{t('room.timeline')}</h2>
      <ul className="mt-2 space-y-1 text-sm text-gray-500">
        {deal.events.map((e) => (
          <li key={e.id}>
            • {t(`events.${e.eventType}`)}{' '}
            <span className="text-xs text-gray-300">{new Date(e.createdAt).toLocaleString(locale)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <Link href="/dashboard/messages" className="text-sm font-medium text-brand-600">{t('room.openChat')} →</Link>
      </div>
      {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function RatingForm({ dealId, rateeId, alreadyRated, onDone }: { dealId: string; rateeId: string; alreadyRated: boolean; onDone: () => Promise<void> }) {
  const t = useTranslations('deals');
  const [stars, setStars] = useState(5);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (alreadyRated) return <p className="rounded-xl border border-gray-100 p-3 text-sm text-emerald-600">✓ {t('room.rated')}</p>;

  const submit = async () => {
    setBusy(true);
    try {
      await apiPost(`/deals/${dealId}/ratings`, { rateeId, stars, tags, comment: comment || undefined });
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <div className="flex gap-1 text-2xl">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setStars(n)} className={n <= stars ? 'text-amber-400' : 'text-gray-200'}>★</button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {RATING_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => setTags((ts) => (ts.includes(tag) ? ts.filter((x) => x !== tag) : [...ts, tag]))}
            className={`rounded-full border px-3 py-1 text-xs ${tags.includes(tag) ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-gray-200 text-gray-500'}`}
          >
            {t(`tags.${tag}`)}
          </button>
        ))}
      </div>
      <textarea className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={2} placeholder={t('room.commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
      <button disabled={busy} onClick={submit} className="mt-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">
        {t('room.submitRating')}
      </button>
    </div>
  );
}
