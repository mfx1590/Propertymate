import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { API_BASE, fmtGbp, fmtMoney, type Property } from '../../../../lib/listings';
import { ActionBox, DetailMap, FavoriteButton } from './parts';

async function fetchListing(id: string): Promise<Property | null> {
  const res = await fetch(`${API_BASE}/properties/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({
  params,
}: {
  params: { id: string; locale: string };
}): Promise<Metadata> {
  const p = await fetchListing(params.id);
  if (!p) return { title: 'Listing not found' };
  const title = p.titleI18n?.en ?? 'Listing';
  return {
    title: `${title} — PropVerify`,
    description: (p.descriptionI18n?.en ?? '').slice(0, 160),
    openGraph: { images: p.media[0]?.url ? [p.media[0].url] : [] },
  };
}

export default async function ListingDetailPage({
  params: { id, locale },
}: {
  params: { id: string; locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations('listings');
  const p = await fetchListing(id);
  if (!p) notFound();

  const title = p.titleI18n?.en ?? '';
  const description = p.descriptionI18n?.en ?? '';
  const regionName = p.region.nameI18n[locale] ?? p.region.nameI18n.en ?? p.region.slug;

  // schema.org RealEstateListing (Plan §6.1 SEO)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: title,
    description: description.slice(0, 500),
    image: p.media.map((m) => m.url),
    offers: {
      '@type': 'Offer',
      price: Number(p.priceAmount),
      priceCurrency: p.priceCurrency,
      availability:
        p.status === 'live' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    },
    ...(p.lat && p.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } }
      : {}),
    address: { '@type': 'PostalAddress', addressRegion: regionName, addressCountry: 'CY' },
    numberOfRooms: p.bedrooms ?? undefined,
    floorSize: p.areaM2 ? { '@type': 'QuantitativeValue', value: p.areaM2, unitCode: 'MTK' } : undefined,
  };

  const facts: Array<[string, string | number | null]> = [
    [t('fields.bedrooms'), p.bedrooms],
    [t('fields.bathrooms'), p.bathrooms],
    [t('fields.areaM2'), p.areaM2 ? `${p.areaM2} m²` : null],
    [t('fields.plotM2'), p.plotM2 ? `${p.plotM2} m²` : null],
    [t('fields.furnished'), p.furnished ? '✓' : null],
    [t('detail.listed'), new Date(p.createdAt).toLocaleDateString(locale)],
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* badges + title */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        {p.status === 'live' && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">✓ {t('detail.verified')}</span>
        )}
        {p.status === 'under_offer' && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{t('status.under_offer')}</span>
        )}
        {(p.status === 'sold' || p.status === 'rented') && (
          <span className="rounded-full bg-purple-50 px-2.5 py-1 text-purple-700">{t(`status.${p.status}`)}</span>
        )}
        {p.deedType !== 'na' && (
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
            {t('detail.deed')}: {t(`deed.${p.deedType}`)}
          </span>
        )}
        <span className="text-gray-400">{t(`kind.${p.kind}`)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-1 text-gray-500">
            {regionName}
            {p.district && ` · ${p.district}`}
          </p>
        </div>
        <div className="text-end">
          <p className="text-3xl font-bold text-brand-600">
            {fmtMoney(Number(p.priceAmount), p.priceCurrency)}
          </p>
          {p.priceCurrency !== 'GBP' && (
            <p className="text-sm text-gray-400">≈ {fmtGbp(Number(p.priceBaseGbp))}</p>
          )}
        </div>
      </div>

      {/* gallery */}
      {p.media.length > 0 && (
        <div className="mt-6 grid grid-cols-4 gap-2">
          {/* eslint-disable @next/next/no-img-element */}
          <img
            src={p.media[0].url}
            alt={title}
            className="col-span-4 h-96 w-full rounded-xl object-cover sm:col-span-3"
          />
          <div className="col-span-4 grid grid-cols-4 gap-2 sm:col-span-1 sm:grid-cols-1">
            {p.media.slice(1, 5).map((m) => (
              <img key={m.id} src={m.url} alt="" className="h-[5.6rem] w-full rounded-lg object-cover" />
            ))}
          </div>
          {/* eslint-enable @next/next/no-img-element */}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* facts */}
          <dl className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 p-5 sm:grid-cols-3">
            {facts
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-gray-400">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
          </dl>

          {/* description */}
          <h2 className="mt-8 text-lg font-semibold">{t('detail.about')}</h2>
          <p className="mt-2 whitespace-pre-line text-gray-700">{description}</p>

          {/* features */}
          {(p.features?.length ?? 0) > 0 && (
            <>
              <h2 className="mt-8 text-lg font-semibold">{t('detail.features')}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.features!.map((f) => (
                  <span key={f} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                    {t(`features.${f}`)}
                  </span>
                ))}
              </div>
            </>
          )}

          {/* map */}
          {p.lat && p.lng && (
            <>
              <h2 className="mt-8 text-lg font-semibold">{t('detail.location')}</h2>
              <div className="mt-2">
                <DetailMap lat={p.lat} lng={p.lng} label={title} />
              </div>
            </>
          )}
        </div>

        {/* sidebar */}
        <aside className="space-y-3">
          <FavoriteButton propertyId={p.id} />
          <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500">
            <p className="font-semibold text-gray-700">{t('detail.trustTitle')}</p>
            <p className="mt-1">{t('detail.trustBody')}</p>
          </div>
          <ActionBox propertyId={p.id} />
        </aside>
      </div>
    </main>
  );
}
