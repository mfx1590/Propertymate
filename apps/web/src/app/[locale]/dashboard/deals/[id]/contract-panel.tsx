'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../../lib/api';

interface Signature {
  userId: string;
  partyRole: string;
  label: string;
  typedName: string | null;
  signedAt: string | null;
  signed: boolean;
}

interface Contract {
  id: string;
  kind: string;
  status: 'awaiting_signatures' | 'signed' | 'void';
  documentId: string;
  terms: { rentAmount: number | null; currency: string; termMonths: number; depositMonths: number };
  mySignature: Signature | null;
  signatures: Signature[];
  signedAt: string | null;
}

/**
 * Contract generation + typed e-sign for the deal room (Plan §7, §6.2).
 *
 * The typed name is the signature, so the control states plainly what pressing
 * the button does before it does it — and the PDF is opened through a
 * short-lived signed URL, never a direct storage link (§2.4).
 */
export function ContractPanel({
  dealId,
  onChange,
  onBlockedChange,
}: {
  dealId: string;
  onChange: () => void;
  /** true while a contract exists but is not fully signed — the stage is blocked */
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const t = useTranslations('contract');
  const locale = useLocale();
  const [contract, setContract] = useState<Contract | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiGet<{ contract: Contract | null }>(`/deals/${dealId}/contract`);
    setContract(res.contract);
    setLoaded(true);
    onBlockedChange?.(res.contract?.status === 'awaiting_signatures');
  }, [dealId, onBlockedChange]);

  useEffect(() => {
    void load().catch(() => setLoaded(true));
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async () => {
    if (!contract) return;
    const { url } = await apiGet<{ url: string }>(`/documents/${contract.documentId}/url`);
    window.open(url, '_blank', 'noopener');
  };

  if (!loaded) return null;

  return (
    <section className="mt-6 rounded-xl border border-gray-200 p-4">
      <h2 className="font-semibold">{t('title')}</h2>

      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!contract ? (
        <>
          <p className="mt-1 text-sm text-gray-500">{t('none')}</p>
          <button
            className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => run(() => apiPost(`/deals/${dealId}/contract`, {}))}
          >
            {busy ? t('generating') : t('generate')}
          </button>
        </>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                contract.status === 'signed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {t(`status.${contract.status}`)}
            </span>
            <button className="text-sm font-medium text-brand-600" onClick={openPdf}>
              {t('openPdf')} →
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-400">{t('rent')}</dt>
              <dd className="font-medium">
                {contract.terms.rentAmount === null
                  ? '—'
                  : new Intl.NumberFormat(locale, {
                      style: 'currency',
                      currency: contract.terms.currency,
                      maximumFractionDigits: 0,
                    }).format(contract.terms.rentAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">{t('term')}</dt>
              <dd className="font-medium">{t('months', { n: contract.terms.termMonths })}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">{t('deposit')}</dt>
              <dd className="font-medium">{t('months', { n: contract.terms.depositMonths })}</dd>
            </div>
          </dl>

          <ul className="mt-4 space-y-1 text-sm">
            {contract.signatures.map((s) => (
              <li key={s.userId} className="flex flex-wrap items-center gap-2">
                <span className="w-28 shrink-0 text-gray-500">{s.label}</span>
                {s.signed ? (
                  <span className="text-emerald-700">
                    ✓ {s.typedName}
                    <span className="ms-2 text-xs text-gray-400">
                      {s.signedAt && new Date(s.signedAt).toLocaleString(locale)}
                    </span>
                  </span>
                ) : (
                  <span className="text-amber-600">{t('awaiting')}</span>
                )}
              </li>
            ))}
          </ul>

          {contract.mySignature && !contract.mySignature.signed && (
            <div className="mt-4 rounded-lg bg-gray-50 p-3">
              <label className="block text-sm font-medium">{t('signPrompt')}</label>
              <p className="mt-0.5 text-xs text-gray-500">{t('signHint')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  className="min-w-48 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder={t('typeYourName')}
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                />
                <button
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  disabled={busy || typedName.trim().length < 2}
                  onClick={() => run(() => apiPost(`/contracts/${contract.id}/sign`, { typedName: typedName.trim() }))}
                >
                  {busy ? t('signing') : t('sign')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
