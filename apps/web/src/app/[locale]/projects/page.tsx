import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '../../../i18n/routing';
import { API_BASE, fmtMoney, type RegionInfo } from '../../../lib/listings';
import { pickI18n, type ProjectCard } from '../../../lib/projects';

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'projects' });
  return { title: `${t('publicDir.title')} — PropVerify`, description: t('publicDir.subtitle') };
}

type Search = { region?: string; minBeds?: string; minPrice?: string; maxPrice?: string };

export default async function ProjectDirectoryPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: Search;
}) {
  setRequestLocale(locale);
  const t = await getTranslations('projects');

  const qs = new URLSearchParams();
  for (const key of ['region', 'minBeds', 'minPrice', 'maxPrice'] as const) {
    if (searchParams[key]) qs.set(key, searchParams[key]!);
  }

  const [projects, regions] = await Promise.all([
    fetch(`${API_BASE}/projects?${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<ProjectCard[]>) : []))
      .catch(() => [] as ProjectCard[]),
    fetch(`${API_BASE}/regions`, { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<RegionInfo[]>) : []))
      .catch(() => [] as RegionInfo[]),
  ]);

  const fieldCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold">{t('publicDir.title')}</h1>
      <p className="mt-1 text-gray-500">{t('publicDir.subtitle')}</p>

      {/* plain GET form so the directory stays crawlable and works without JS */}
      <form className="mt-6 grid gap-3 rounded-xl border border-gray-200 p-4 sm:grid-cols-5">
        <label className="block">
          <span className="text-xs text-gray-500">{t('publicDir.region')}</span>
          <select name="region" defaultValue={searchParams.region ?? ''} className={fieldCls}>
            <option value="">{t('publicDir.anyRegion')}</option>
            {regions.map((r) => (
              <option key={r.slug} value={r.slug}>
                {pickI18n(r.nameI18n, locale) || r.slug}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">{t('publicDir.minBeds')}</span>
          <select name="minBeds" defaultValue={searchParams.minBeds ?? ''} className={fieldCls}>
            <option value="">{t('publicDir.any')}</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">{t('publicDir.minPrice')}</span>
          <input
            name="minPrice"
            type="number"
            min={0}
            defaultValue={searchParams.minPrice ?? ''}
            className={fieldCls}
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500">{t('publicDir.maxPrice')}</span>
          <input
            name="maxPrice"
            type="number"
            min={0}
            defaultValue={searchParams.maxPrice ?? ''}
            className={fieldCls}
          />
        </label>
        <div className="flex items-end gap-2">
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            {t('publicDir.apply')}
          </button>
          <Link href="/projects" className="px-2 py-2 text-sm text-gray-500">
            {t('publicDir.clear')}
          </Link>
        </div>
      </form>

      {projects.length === 0 ? (
        <p className="mt-10 text-gray-500">{t('publicDir.empty')}</p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-xl border border-gray-200">
              <Link href={`/projects/${p.id}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt={p.name} className="h-44 w-full object-cover" />
                ) : (
                  <div className="flex h-44 items-center justify-center bg-gray-100 text-3xl">🏗️</div>
                )}
                <div className="p-4">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="text-sm text-gray-500">
                    {pickI18n(p.region?.nameI18n, locale) || p.region?.slug}
                  </p>
                  {p.developerName && (
                    <p className="mt-0.5 truncate text-xs text-gray-400">{p.developerName}</p>
                  )}
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <p className="text-xs text-gray-400">{t('publicDir.from')}</p>
                      <p className="font-bold text-brand-600">
                        {p.unitStats.priceFrom !== null && p.unitStats.currency
                          ? fmtMoney(p.unitStats.priceFrom, p.unitStats.currency)
                          : '—'}
                      </p>
                    </div>
                    <p className="text-end text-xs text-gray-400">
                      {t('board.availability', {
                        available: p.unitStats.available,
                        total: p.unitStats.total,
                      })}
                      {p.deliveryDate && (
                        <>
                          <br />
                          {t('publicDir.delivery')} {new Date(p.deliveryDate).getFullYear()}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
