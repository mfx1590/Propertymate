import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES } from '@propverify/shared';
import { API_BASE, type SearchHit } from '../../../../lib/listings';
import { Link } from '../../../../i18n/routing';
import { Money } from '../../../../components/Money';
import { CurrencySwitcher } from '../../../../components/CurrencySwitcher';

/** The six top-level regions (Plan §1). Static so the routes prerender. */
const REGION_SLUGS = ['kyrenia', 'famagusta', 'iskele', 'nicosia', 'guzelyurt', 'lefke'] as const;

interface PriceBand {
  count: number;
  medianGbp: number | null;
  minGbp: number | null;
  maxGbp: number | null;
  medianPerM2: number | null;
}

interface RegionDetail {
  slug: string;
  nameI18n: Record<string, string>;
  lat: number | null;
  lng: number | null;
  children: { slug: string; nameI18n: Record<string, string> }[];
  stats: {
    total: number;
    forSale: number;
    forRent: number;
    sale: PriceBand;
    rent: PriceBand;
    deedTypes: Record<string, number>;
  };
}

/** Deduped across generateMetadata and the page body in one render pass. */
const fetchRegion = cache(async (slug: string): Promise<RegionDetail | null> => {
  const res = await fetch(`${API_BASE}/regions/${slug}`, { next: { revalidate: 300 } });
  return res.ok ? ((await res.json()) as RegionDetail) : null;
});

const fetchListings = cache(async (slug: string): Promise<SearchHit[]> => {
  const res = await fetch(`${API_BASE}/search/listings?region=${slug}&sort=newest`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { hits?: SearchHit[] };
  return json.hits ?? [];
});

export function generateStaticParams() {
  return LOCALES.flatMap((locale) => REGION_SLUGS.map((slug) => ({ locale, slug })));
}

/**
 * The region's name in the reader's language.
 *
 * Prefers the message catalogue over the API's `name_i18n`, because the seeded
 * Russian and Farsi values are still the English string — and this name is the
 * page title, which for those audiences is the entire point of the page. Falls
 * back to the API for any region not in the catalogue (a district, later).
 */
function regionName(
  t: (key: string) => string,
  r: RegionDetail,
  locale: string,
  slug: string,
): string {
  try {
    const fromCatalogue = t(`names.${slug}`);
    if (fromCatalogue && !fromCatalogue.startsWith('names.')) return fromCatalogue;
  } catch {
    /* not one of the six top-level regions */
  }
  return r.nameI18n[locale] || r.nameI18n.en || r.slug;
}

export async function generateMetadata({
  params: { locale, slug },
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const region = await fetchRegion(slug);
  if (!region) return {};
  const t = await getTranslations({ locale, namespace: 'regionPage' });
  const n = regionName(t, region, locale, slug);
  return {
    title: t('metaTitle', { region: n }),
    description: t('metaDescription', { region: n, count: region.stats.total }),
    alternates: {
      canonical: `/${locale}/region/${slug}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/region/${slug}`])),
    },
  };
}

export default async function RegionPage({
  params: { locale, slug },
}: {
  params: { locale: string; slug: string };
}) {
  setRequestLocale(locale);
  const [region, listings] = await Promise.all([fetchRegion(slug), fetchListings(slug)]);
  if (!region) notFound();

  const t = await getTranslations('regionPage');
  const ts = await getTranslations('search');
  const n = regionName(t, region, locale, slug);
  const { stats } = region;

  // Only describe a deed mix once there is enough of one to be meaningful —
  // "100% Turkish title" off two listings is noise dressed as insight.
  const deedEntries = Object.entries(stats.deedTypes)
    .filter(([key]) => key !== 'na')
    .sort((a, b) => b[1] - a[1]);
  const showDeeds = stats.total >= 5 && deedEntries.length > 0;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: t('metaTitle', { region: n }),
    description: t('metaDescription', { region: n, count: stats.total }),
    about: {
      '@type': 'Place',
      name: n,
      ...(region.lat && region.lng
        ? { geo: { '@type': 'GeoCoordinates', latitude: region.lat, longitude: region.lng } }
        : {}),
    },
    numberOfItems: stats.total,
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-sm text-gray-400">
        <Link href="/" className="hover:text-brand-600">
          {t('home')}
        </Link>{' '}
        / <span className="text-gray-600">{n}</span>
      </nav>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-3xl font-bold">{t('heading', { region: n })}</h1>
        <CurrencySwitcher />
      </div>
      <p className="mt-3 max-w-3xl text-gray-600">{t(`intro.${slug}`)}</p>

      {stats.total === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-gray-500">
          {t('noListings', { region: n })}
        </p>
      ) : (
        <>
          {/* The numbers a buyer arriving from a search engine does not have. */}
          <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('stats.verified')} value={String(stats.total)} />
            {stats.sale.count > 0 && (
              <Stat
                label={t('stats.medianSale')}
                value={<Money gbp={stats.sale.medianGbp as number} />}
                hint={
                  stats.sale.medianPerM2 ? (
                    <>
                      {/* Must use the same currency as the figure above it —
                          a £ hint under a ₺ headline reads as an error. */}
                      <Money gbp={stats.sale.medianPerM2} /> {t('stats.perM2')}
                    </>
                  ) : undefined
                }
              />
            )}
            {stats.rent.count > 0 && (
              <Stat
                label={t('stats.medianRent')}
                value={<Money gbp={stats.rent.medianGbp as number} />}
                hint={t('stats.perMonth')}
              />
            )}
            {stats.sale.count > 0 && (
              <Stat
                label={t('stats.saleRange')}
                value={
                  <span className="text-base">
                    <Money gbp={stats.sale.minGbp as number} /> –{' '}
                    <Money gbp={stats.sale.maxGbp as number} />
                  </span>
                }
              />
            )}
          </section>

          {showDeeds && (
            <section className="mt-6 rounded-xl border border-gray-200 p-5">
              <h2 className="font-semibold">{t('deeds.title')}</h2>
              {/* The deed type is the most consequential thing about a TRNC
                  property and the thing a foreign buyer least expects. */}
              <p className="mt-1 text-sm text-gray-500">{t('deeds.body')}</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {deedEntries.map(([key, count]) => (
                  <li key={key}>
                    <Link
                      href={`/search?region=${slug}&deedType=${key}`}
                      className="rounded-full border border-gray-300 px-3 py-1 text-sm hover:border-brand-500 hover:text-brand-600"
                    >
                      {ts(`deed.${key}`)} <span className="text-gray-400">({count})</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-6 flex flex-wrap gap-2">
            {stats.forSale > 0 && (
              <Link
                href={`/search?region=${slug}&kind=resale`}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
              >
                {t('cta.forSale', { count: stats.forSale })}
              </Link>
            )}
            {stats.forRent > 0 && (
              <Link
                href={`/search?region=${slug}&kind=rental`}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium"
              >
                {t('cta.forRent', { count: stats.forRent })}
              </Link>
            )}
          </section>

          {listings.length > 0 && (
            <section className="mt-10">
              <h2 className="text-xl font-semibold">{t('latest', { region: n })}</h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {listings.slice(0, 9).map((h) => (
                  <li key={h.id} className="overflow-hidden rounded-xl border border-gray-200">
                    <Link href={`/listing/${h.id}`} className="group block">
                      {h.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={h.coverUrl} alt="" className="h-40 w-full object-cover" />
                      ) : (
                        <div className="h-40 w-full bg-gray-100" />
                      )}
                      <div className="p-3">
                        <p className="truncate font-semibold group-hover:text-brand-600">
                          {h.title}
                        </p>
                        <p className="text-sm text-gray-500">
                          {h.district ?? h.regionName}
                          {h.bedrooms != null && ` · ${h.bedrooms} ${ts('beds')}`}
                        </p>
                        <p className="mt-1 font-bold text-brand-600">
                          <Money gbp={h.priceBaseGbp} />
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Internal links: the other regions, so a landing page is a way in
          rather than a dead end for someone who picked the wrong one. */}
      <section className="mt-12 border-t border-gray-200 pt-6">
        <h2 className="font-semibold text-gray-700">{t('otherRegions')}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {REGION_SLUGS.filter((s) => s !== slug).map((s) => (
            <li key={s}>
              <Link
                href={`/region/${s}`}
                className="rounded-full border border-gray-300 px-4 py-1.5 text-sm hover:border-brand-500 hover:text-brand-600"
              >
                {t(`names.${s}`)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
