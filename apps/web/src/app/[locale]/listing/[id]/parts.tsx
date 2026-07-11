'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost, getAccessToken } from '../../../../lib/api';
import { useRouter } from '../../../../i18n/routing';
import type { Property } from '../../../../lib/listings';

const MapView = dynamic(() => import('../../../../components/MapView'), { ssr: false });

export function DetailMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return <MapView center={{ lat, lng }} zoom={14} markers={[{ id: 'x', lat, lng, label }]} />;
}

export function FavoriteButton({ propertyId }: { propertyId: string }) {
  const t = useTranslations('listings');
  const router = useRouter();
  const [favored, setFavored] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) return;
    setAuthed(true);
    void apiGet<Property[]>('/users/me/favorites')
      .then((favs) => setFavored(favs.some((f) => f.id === propertyId)))
      .catch(() => undefined);
  }, [propertyId]);

  const toggle = async () => {
    if (!authed) {
      router.push('/auth');
      return;
    }
    if (favored) {
      await apiDelete(`/properties/${propertyId}/favorite`);
      setFavored(false);
    } else {
      await apiPost(`/properties/${propertyId}/favorite`);
      setFavored(true);
    }
  };

  return (
    <button
      onClick={toggle}
      className={`w-full rounded-xl border-2 px-4 py-3 font-medium transition ${
        favored
          ? 'border-rose-300 bg-rose-50 text-rose-600'
          : 'border-gray-200 text-gray-700 hover:border-rose-300'
      }`}
    >
      {favored ? `♥ ${t('detail.saved')}` : `♡ ${t('detail.save')}`}
    </button>
  );
}
