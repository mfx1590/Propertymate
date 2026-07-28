'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { apiPost, getAccessToken } from '../../../../lib/api';
import { useRouter } from '../../../../i18n/routing';

const MapView = dynamic(() => import('../../../../components/MapView'), { ssr: false });

export function ProjectMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return <MapView center={{ lat, lng }} zoom={13} markers={[{ id: 'x', lat, lng, label }]} />;
}

export function InquireBox({ projectId }: { projectId: string }) {
  const t = useTranslations('projects');
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!getAccessToken()) {
      router.push('/auth');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/projects/${projectId}/inquire`, { message });
      setDone(true);
      setMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 p-4">
      <p className="font-semibold text-gray-700">{t('detail.inquire')}</p>
      {done ? (
        <p className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-700">{t('detail.sent')}</p>
      ) : (
        <>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            rows={3}
            placeholder={t('detail.inquirePlaceholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy || !message.trim()}
            onClick={send}
          >
            {busy ? t('detail.sending') : t('detail.send')}
          </button>
        </>
      )}
      {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <p className="text-[11px] text-gray-400">{t('detail.inquireHint')}</p>
    </div>
  );
}

export function ReserveButton({ unitId, disabled }: { unitId: string; disabled: boolean }) {
  const t = useTranslations('projects');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reserve = async () => {
    if (!getAccessToken()) {
      router.push('/auth');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { dealId } = await apiPost<{ dealId: string }>(`/units/${unitId}/reserve`);
      router.push(`/dashboard/deals/${dealId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (disabled) return null;

  return (
    <>
      <button
        onClick={reserve}
        disabled={busy}
        className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? t('detail.reserving') : t('detail.reserve')}
      </button>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </>
  );
}
