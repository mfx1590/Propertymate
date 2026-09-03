'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError, apiGet, apiPost } from '../../../../../lib/api';
import { Link } from '../../../../../i18n/routing';

/**
 * Opening a dispute from the deal room (step 26) — the surface that never
 * existed: the API could take a case since step 9, but no page offered one.
 *
 * Collapsed behind one quiet button on purpose. A dispute is the exceptional
 * exit, not a feature to advertise beside the timeline; but when someone
 * needs it, hunting for it is the last thing they should be doing.
 */
export function DisputePanel({
  dealId,
  parties,
  partyLabel,
}: {
  dealId: string;
  parties: { userId: string; partyRole: string }[];
  /** Localised label for a party role — the deal room already renders these. */
  partyLabel: (role: string) => string;
}) {
  const t = useTranslations('disputes');
  const [openForm, setOpenForm] = useState(false);
  const [against, setAgainst] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ id: string }>('/users/me').then((me) => setMyUserId(me.id)).catch(() => undefined);
  }, []);

  const others = parties.filter((p) => p.userId !== myUserId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/deals/${dealId}/disputes`, { againstUserId: against, reason });
      setDone(true);
      setOpenForm(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-800">
        {t('opened')}{' '}
        <Link href="/dashboard/disputes" className="underline">
          {t('openedLink')}
        </Link>
      </p>
    );
  }

  return (
    <div className="mt-6">
      {!openForm ? (
        <button
          onClick={() => {
            setOpenForm(true);
            setAgainst(others.length === 1 ? others[0].userId : '');
          }}
          className="text-sm text-gray-400 underline decoration-dotted underline-offset-4 hover:text-gray-600"
        >
          {t('reportProblem')}
        </button>
      ) : (
        <section className="rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold">{t('formTitle')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('formHint')}</p>
          {others.length > 1 && (
            <select
              className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={against}
              onChange={(e) => setAgainst(e.target.value)}
            >
              <option value="">{t('formAgainst')}</option>
              {others.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {partyLabel(p.partyRole)}
                </option>
              ))}
            </select>
          )}
          <textarea
            rows={3}
            className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder={t('formReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-3 flex gap-2">
            <button
              disabled={busy || !against || reason.trim().length < 10}
              onClick={() => void submit()}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('formSubmit')}
            </button>
            <button
              onClick={() => setOpenForm(false)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600"
            >
              {t('formCancel')}
            </button>
          </div>
          {error && <p className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </section>
      )}
    </div>
  );
}
