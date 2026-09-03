import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { API_BASE, type RegionInfo } from '../../../lib/listings';
import { Link } from '../../../i18n/routing';

interface DirectoryLawyer {
  userId: string;
  name: string;
  bio: string | null;
  regions: string[];
  languages: string[];
  feeModel: string | null;
  feeNote: string | null;
  engagementCount: number;
}

/**
 * The public half of the lawyer marketplace (§10.2).
 *
 * Server-rendered on demand rather than prerendered, for the reason step 16
 * learned the hard way: `generateStaticParams` here would make the build fetch
 * from an API that is not running when the image is built.
 */
export const revalidate = 300;

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'legal' });
  return {
    title: t('directory.metaTitle'),
    description: t('directory.metaDescription'),
  };
}

async function fetchDirectory(region?: string, language?: string): Promise<DirectoryLawyer[]> {
  const qs = new URLSearchParams();
  if (region) qs.set('region', region);
  if (language) qs.set('language', language);
  try {
    const res = await fetch(`${API_BASE}/lawyers/directory?${qs}`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchRegions(): Promise<RegionInfo[]> {
  try {
    const res = await fetch(`${API_BASE}/regions`, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export default async function LawyersPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { region?: string; language?: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  const [lawyers, regions] = await Promise.all([
    fetchDirectory(searchParams.region, searchParams.language),
    fetchRegions(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-bold">{t('directory.title')}</h1>
      <p className="mt-2 max-w-2xl text-gray-600">{t('directory.blurb')}</p>

      {/* A plain GET form, so the page works with no JavaScript and every
          filtered view has its own shareable URL. */}
      <form className="mt-6 flex flex-wrap gap-2" method="get">
        <select
          name="region"
          defaultValue={searchParams.region ?? ''}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">{t('directory.anyRegion')}</option>
          {regions.map((r) => (
            <option key={r.slug} value={r.slug}>
              {r.nameI18n[locale] ?? r.nameI18n.en}
            </option>
          ))}
        </select>
        <select
          name="language"
          defaultValue={searchParams.language ?? ''}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">{t('directory.anyLanguage')}</option>
          {['en', 'tr', 'ru', 'fa'].map((l) => (
            <option key={l} value={l}>{t(`languages.${l}`)}</option>
          ))}
        </select>
        <button className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white">
          {t('directory.filter')}
        </button>
      </form>

      {lawyers.length === 0 ? (
        <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50/60 p-8">
          <p className="font-semibold text-gray-800">{t('directory.emptyTitle')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('directory.emptyBody')}</p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {lawyers.map((l) => (
            <li key={l.userId} className="rounded-xl border border-gray-200 p-5 transition hover:shadow-md">
              <Link href={`/lawyers/${l.userId}`}>
                <div className="flex items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                    ✓ {t('directory.verified')}
                  </span>
                  {l.engagementCount > 0 && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                      {t('directory.engagements', { count: l.engagementCount })}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-lg font-semibold">{l.name}</p>
                {l.bio && <p className="mt-1 line-clamp-3 text-sm text-gray-600">{l.bio}</p>}
                <p className="mt-3 text-sm text-gray-500">
                  {l.regions.length
                    ? l.regions.map((r) => regions.find((x) => x.slug === r)?.nameI18n[locale] ?? r).join(', ')
                    : t('allRegions')}
                </p>
                {l.languages.length > 0 && (
                  <p className="text-sm text-gray-500">
                    {l.languages.map((x) => t(`languages.${x}`)).join(' · ')}
                  </p>
                )}
                {l.feeNote && <p className="mt-2 text-sm text-brand-600">{l.feeNote}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Says plainly what the platform does and does not vouch for. */}
      <p className="mt-8 rounded-xl border border-gray-200 bg-gray-50/60 p-4 text-sm text-gray-500">
        {t('directory.disclaimer')}
      </p>
    </main>
  );
}
