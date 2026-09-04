'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiGet, apiPost } from '../../../../../../lib/api';
import { useRouter } from '../../../../../../i18n/routing';

const REASON_CODES = ['illegible', 'expired', 'name_mismatch', 'wrong_type', 'suspected_forgery', 'other'];

interface ReviewDoc {
  id: string;
  documentType: string;
  /** step 28: what local OCR read off an identity document, if anything */
  docNumber?: string | null;
  mime: string;
  status: string;
  rejectReasonCode: string | null;
  uploadedAt: string;
  signedUrl: string;
}

interface Detail {
  id: string;
  entityType: string;
  status: string;
  slaDueAt: string;
  listing?: {
    property: {
      id: string;
      kind: string;
      titleI18n: { en?: string };
      deedType: string;
      priceAmount: string;
      priceCurrency: string;
      bedrooms: number | null;
      areaM2: number | null;
      district: string | null;
      media: { id: string; url: string }[];
      region: { slug: string };
      createdBy: { phone: string | null; email: string | null };
    };
    documents: ReviewDoc[];
    fraudSignals: string[];
  };
  profile?: {
    userRole: {
      verificationStatus: string;
      role: { key: string; name: string };
      user: { phone: string | null; email: string | null; createdAt: string };
    };
    documents: ReviewDoc[];
    fraudSignals: string[];
  };
}

type Decision = { status: 'approved' | 'rejected'; rejectReasonCode?: string; rejectNote?: string };

export default function ReviewDetailPage() {
  const t = useTranslations('admin');
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<Detail>(`/admin/verification/${id}`)
      .then((d) => {
        setDetail(d);
        const docs = d.listing?.documents ?? d.profile?.documents ?? [];
        const initial: Record<string, Decision> = {};
        for (const doc of docs) {
          initial[doc.id] = { status: doc.status === 'rejected' ? 'rejected' : 'approved' };
        }
        setDecisions(initial);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (error) return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  if (!detail) return <p className="text-gray-400">…</p>;

  const docs = detail.listing?.documents ?? detail.profile?.documents ?? [];
  const fraudSignals = detail.listing?.fraudSignals ?? detail.profile?.fraudSignals ?? [];
  const decided = detail.status === 'approved' || detail.status === 'rejected';

  const setDecision = (docId: string, patch: Partial<Decision>) =>
    setDecisions((d) => ({ ...d, [docId]: { ...d[docId], ...patch } }));

  const submit = () =>
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await apiPost(`/admin/verification/${id}/decision`, {
          documentDecisions: Object.entries(decisions).map(([documentId, d]) => ({ documentId, ...d })),
          note: note || undefined,
        });
        router.push('/dashboard/admin/queue');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      }
    })();

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('review.title')}</h1>

      {/* entity summary */}
      {detail.listing && (
        <div className="mt-4 rounded-xl border border-gray-200 p-5">
          <p className="text-lg font-semibold">{detail.listing.property.titleI18n.en}</p>
          <p className="mt-1 text-sm text-gray-500">
            {detail.listing.property.kind} · {detail.listing.property.region.slug}
            {detail.listing.property.district && ` · ${detail.listing.property.district}`} ·{' '}
            {detail.listing.property.priceAmount} {detail.listing.property.priceCurrency} · deed:{' '}
            <b>{detail.listing.property.deedType}</b> ·{' '}
            {t('review.lister')}: {detail.listing.property.createdBy.email ?? detail.listing.property.createdBy.phone}
          </p>
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {detail.listing.property.media.map((m) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={m.url} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover" />
            ))}
          </div>
        </div>
      )}
      {detail.profile && (
        <div className="mt-4 rounded-xl border border-gray-200 p-5">
          <p className="text-lg font-semibold">
            {detail.profile.userRole.role.name} {t('review.profileApplication')}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {detail.profile.userRole.user.email ?? detail.profile.userRole.user.phone} ·{' '}
            {t('review.memberSince')} {new Date(detail.profile.userRole.user.createdAt).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* fraud signals */}
      {fraudSignals.length > 0 && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="font-semibold text-red-800">⚠ {t('review.fraudTitle')}</p>
          <ul className="mt-1 list-inside list-disc text-sm text-red-700">
            {fraudSignals.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* documents */}
      <h2 className="mt-6 font-semibold text-gray-700">{t('review.documents')}</h2>
      {docs.length === 0 && <p className="mt-2 text-sm text-amber-600">{t('review.noDocs')}</p>}
      <div className="mt-2 space-y-3">
        {docs.map((doc) => {
          const d = decisions[doc.id];
          return (
            <div key={doc.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{doc.documentType}</span>
                {/* step 28: the number OCR read — beside the scan, so the admin
                    can check the machine against the paper in one glance */}
                {doc.docNumber && (
                  <span className="ms-2 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600">
                    {t('docNumberRead', { number: doc.docNumber })}
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  {new Date(doc.uploadedAt).toLocaleString()} · {doc.mime}
                </span>
                <a
                  href={doc.signedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-brand-600 px-3 py-1.5 text-sm font-medium text-brand-600"
                >
                  {t('review.open')}
                </a>
                <span className="ms-auto flex gap-1">
                  {(['approved', 'rejected'] as const).map((s) => (
                    <button
                      key={s}
                      disabled={decided}
                      onClick={() => setDecision(doc.id, { status: s })}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                        d?.status === s
                          ? s === 'approved'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-red-600 text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {t(`review.${s}`)}
                    </button>
                  ))}
                </span>
              </div>
              {doc.mime.startsWith('image/') && (
                <div className="relative mt-3 inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc.signedUrl} alt="" className="max-h-72 rounded-lg" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-black text-white/50 [text-shadow:0_1px_4px_rgba(0,0,0,.5)]">
                    VERIFICATION COPY
                  </span>
                </div>
              )}
              {d?.status === 'rejected' && !decided && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <select
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={d.rejectReasonCode ?? ''}
                    onChange={(e) => setDecision(doc.id, { rejectReasonCode: e.target.value })}
                  >
                    <option value="">{t('review.pickReason')}</option>
                    {REASON_CODES.map((r) => (
                      <option key={r} value={r}>
                        {t(`reasons.${r}`)}
                      </option>
                    ))}
                  </select>
                  <input
                    className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    placeholder={t('review.rejectNote')}
                    value={d.rejectNote ?? ''}
                    onChange={(e) => setDecision(doc.id, { rejectNote: e.target.value })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* final decision */}
      {!decided && (
        <div className="mt-6 space-y-3 rounded-xl border border-gray-200 p-4">
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={2}
            placeholder={t('review.internalNote')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            onClick={submit}
            disabled={busy || docs.length === 0}
            className="rounded-lg bg-brand-600 px-6 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {t('review.submitDecision')}
          </button>
          <p className="text-xs text-gray-400">{t('review.submitHint')}</p>
        </div>
      )}
      {decided && (
        <p className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
          {t('review.alreadyDecided', { status: detail.status })}
        </p>
      )}
      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
