import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { API_BASE, fmtMoney } from '../../../../lib/listings';
import { UNIT_STATUS_STYLES, pickI18n, type ProjectDetail } from '../../../../lib/projects';
import { InquireBox, ProjectMap, ReserveButton } from './parts';

async function fetchProject(id: string): Promise<ProjectDetail | null> {
  const res = await fetch(`${API_BASE}/projects/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({
  params,
}: {
  params: { id: string; locale: string };
}): Promise<Metadata> {
  const p = await fetchProject(params.id);
  if (!p) return { title: 'Project not found' };
  const name = pickI18n(p.nameI18n, params.locale) || 'Project';
  return {
    title: `${name} — PropVerify`,
    description: pickI18n(p.descriptionI18n, params.locale).slice(0, 160),
    openGraph: { images: p.media[0]?.url ? [p.media[0].url] : [] },
  };
}

export default async function ProjectDetailPage({
  params: { id, locale },
}: {
  params: { id: string; locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations('projects');
  const p = await fetchProject(id);
  if (!p) notFound();

  const name = pickI18n(p.nameI18n, locale);
  const description = pickI18n(p.descriptionI18n, locale);
  const regionName = pickI18n(p.region?.nameI18n, locale) || p.region?.slug;
  const stats = p.unitStats;
  const developerName = p.developer?.developerProfile?.companyName ?? null;

  // schema.org: a project is a set of offers rather than a single listing (§6.1 SEO)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name,
    description: description.slice(0, 500),
    image: p.media.map((m) => m.url),
    numberOfAccommodationUnits: stats.total,
    numberOfAvailableAccommodationUnits: stats.available,
    ...(stats.priceFrom !== null && stats.currency
      ? {
          makesOffer: {
            '@type': 'Offer',
            price: stats.priceFrom,
            priceCurrency: stats.currency,
            availability:
              stats.available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
          },
        }
      : {}),
    ...(p.lat && p.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng } }
      : {}),
    address: { '@type': 'PostalAddress', addressRegion: regionName, addressCountry: 'CY' },
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
          ✓ {t('detail.verified')}
        </span>
        {developerName && <span className="text-gray-400">{developerName}</span>}
      </div>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{name}</h1>
          <p className="mt-1 text-gray-500">
            {regionName}
            {p.deliveryDate &&
              ` · ${t('detail.delivery')} ${new Date(p.deliveryDate).toLocaleDateString(locale)}`}
          </p>
        </div>
        {stats.priceFrom !== null && stats.currency && (
          <div className="text-end">
            <p className="text-xs text-gray-400">{t('detail.from')}</p>
            <p className="text-3xl font-bold text-brand-600">
              {fmtMoney(stats.priceFrom, stats.currency)}
            </p>
          </div>
        )}
      </div>

      {/* gallery */}
      {p.media.length > 0 && (
        <div className="mt-6 grid grid-cols-4 gap-2">
          {/* eslint-disable @next/next/no-img-element */}
          <img
            src={p.media[0].url}
            alt={name}
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
          {/* availability roll-up */}
          <dl className="grid grid-cols-2 gap-4 rounded-xl border border-gray-200 p-5 sm:grid-cols-4">
            {(
              [
                [t('unitStatus.available'), stats.available],
                [t('unitStatus.reserved'), stats.reserved],
                [t('unitStatus.sold'), stats.sold],
                [t('detail.beds'), stats.bedroomOptions.join(', ') || '—'],
              ] as Array<[string, string | number]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-gray-400">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>

          <h2 className="mt-8 text-lg font-semibold">{t('detail.about')}</h2>
          <p className="mt-2 whitespace-pre-line text-gray-700">{description}</p>

          {/* availability grid — never shows who holds a unit (§13.4) */}
          <h2 className="mt-8 text-lg font-semibold">{t('detail.availability')}</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-xs text-gray-400">
                  <th className="p-2 text-start font-medium">{t('detail.unit')}</th>
                  <th className="p-2 text-start font-medium">{t('detail.type')}</th>
                  <th className="p-2 text-start font-medium">{t('detail.beds')}</th>
                  <th className="p-2 text-start font-medium">{t('detail.area')}</th>
                  <th className="p-2 text-start font-medium">{t('detail.floor')}</th>
                  <th className="p-2 text-start font-medium">{t('detail.price')}</th>
                  <th className="p-2 text-start font-medium">{t('detail.status')}</th>
                </tr>
              </thead>
              <tbody>
                {p.units.map((u) => (
                  <tr key={u.id} className="border-t border-gray-100">
                    <td className="p-2 font-medium">{u.unitNo}</td>
                    <td className="p-2">{u.type ?? '—'}</td>
                    <td className="p-2">{u.bedrooms ?? '—'}</td>
                    <td className="p-2">{u.areaM2 ? `${u.areaM2} m²` : '—'}</td>
                    <td className="p-2">{u.floor ?? '—'}</td>
                    <td className="p-2">{fmtMoney(Number(u.priceAmount), u.priceCurrency)}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${UNIT_STATUS_STYLES[u.status]}`}
                        >
                          {t(`unitStatus.${u.status}`)}
                        </span>
                        <ReserveButton unitId={u.id} disabled={u.status !== 'available'} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-400">{t('detail.reserveHint')}</p>

          {/* payment plans */}
          {(p.paymentPlans?.length ?? 0) > 0 && (
            <>
              <h2 className="mt-8 text-lg font-semibold">{t('detail.paymentPlans')}</h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {p.paymentPlans!.map((plan, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-4">
                    <p className="font-semibold">{plan.name}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {plan.downPaymentPct}% {t('detail.downPayment')}
                      {plan.installments > 0 && (
                        <>
                          {' · '}
                          {t('detail.installments', { count: plan.installments })}{' '}
                          {plan.installmentFrequency === 'quarterly'
                            ? t('detail.quarterly')
                            : t('detail.monthly')}
                        </>
                      )}
                      {!!plan.onDeliveryPct && (
                        <> {` · ${t('detail.onDelivery', { pct: plan.onDeliveryPct })}`}</>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* construction progress */}
          <h2 className="mt-8 text-lg font-semibold">{t('detail.progress')}</h2>
          {p.updates.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">{t('detail.noProgress')}</p>
          ) : (
            <ol className="mt-2 space-y-3 border-s-2 border-gray-100 ps-4">
              {p.updates.map((u) => (
                <li key={u.id}>
                  <p className="text-xs text-gray-400">
                    {new Date(u.publishedAt).toLocaleDateString(locale)}
                  </p>
                  <p className="font-medium">{pickI18n(u.titleI18n, locale)}</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-gray-600">
                    {pickI18n(u.bodyI18n, locale)}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {p.lat && p.lng && (
            <>
              <h2 className="mt-8 text-lg font-semibold">{t('detail.location')}</h2>
              <div className="mt-2">
                <ProjectMap lat={p.lat} lng={p.lng} label={name} />
              </div>
            </>
          )}
        </div>

        <aside className="space-y-3">
          <InquireBox projectId={p.id} />
        </aside>
      </div>
    </main>
  );
}
