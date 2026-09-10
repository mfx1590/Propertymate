import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES } from '@propverify/shared';
import { API_BASE } from '../../lib/listings';
import { Link } from '../../i18n/routing';
import { LandingJourney } from '../../components/landing/LandingJourney';
import type { SceneId } from '../../components/landing/manifest';

/**
 * The homepage: "Through the Layers of the Island" (docs/landing-concept.md).
 *
 * Everything the page is for — h1, search, region links, the trust pitch —
 * is in this server-rendered HTML. The scroll journey the LandingJourney
 * component builds over the hero is progressive enhancement; without JS or
 * with reduced motion the hero is a static poster composition and the rest
 * of the page reads top-to-bottom exactly as before.
 */

/** Fallback when the API is unreachable — notably during CI's build, which
 *  prerenders this page with no API running. Names come from the catalogue. */
const REGION_SLUGS = ['kyrenia', 'famagusta', 'iskele', 'nicosia', 'guzelyurt', 'lefke'] as const;

interface Region {
  slug: string;
  nameI18n: Record<string, string>;
}

/** Rendered on demand and cached five minutes, like every other public page
 *  (Plan §6.1) — never baked into the build. */
export const revalidate = 300;

async function fetchRegions(): Promise<Region[] | null> {
  try {
    const res = await fetch(`${API_BASE}/regions`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = (await res.json()) as Region[];
    return Array.isArray(json) && json.length > 0 ? json : null;
  } catch {
    return null;
  }
}

export default async function HomePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations();
  const regions = (await fetchRegions()) ?? REGION_SLUGS.map((slug) => ({ slug, nameI18n: {} }));

  /** Catalogue name first (it carries the dual EN/TR form and the fixed
   *  RU/FA translations), API name as fallback for anything uncatalogued. */
  const regionName = (r: Region) => {
    try {
      const fromCatalogue = t(`regionPage.names.${r.slug}`);
      if (fromCatalogue && !fromCatalogue.startsWith('regionPage.')) return fromCatalogue;
    } catch {
      /* not one of the six top-level regions */
    }
    return r.nameI18n[locale] || r.nameI18n.en || r.slug;
  };

  const captions: Partial<Record<SceneId, string>> = {
    coast: t('home.journey.coast'),
    valley: t('home.journey.valley'),
    neighbourhood: t('home.journey.neighbourhood'),
    villa: t('home.journey.villa'),
  };

  const hero = (
    <div className="mx-auto max-w-3xl text-center">
      <h1 className="text-4xl font-extrabold tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)] sm:text-5xl">
        {t('home.heroTitle')}
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-lg text-white/95 [text-shadow:0_1px_16px_rgba(0,0,0,0.5)]">
        {t('home.heroSubtitle')}
      </p>
      <form
        action={`/${locale}/search`}
        className="mx-auto mt-8 flex max-w-xl gap-2 rounded-2xl bg-white/95 p-2 shadow-xl backdrop-blur"
      >
        <input
          name="q"
          className="w-full rounded-xl border-0 bg-transparent px-4 py-3 text-gray-900 placeholder:text-gray-500 focus:outline-none"
          placeholder={t('home.searchPlaceholder')}
        />
        <button
          type="submit"
          className="shrink-0 rounded-xl bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-500"
        >
          {t('common.search')}
        </button>
      </form>
    </div>
  );

  const hold = (
    <div className="mx-auto max-w-xl px-4 text-center">
      <p className="text-2xl font-bold text-white [text-shadow:0_2px_20px_rgba(0,0,0,0.6)]">
        {t('home.journey.holdTitle')}
      </p>
      <Link
        href="/search"
        className="mt-6 inline-block rounded-xl bg-white/95 px-8 py-3 font-semibold text-brand-600 shadow-xl hover:bg-white"
      >
        {t('home.journey.holdCta')}
      </Link>
    </div>
  );

  return (
    <main>
      {/* header — floats over the sky; every job it had before is intact */}
      <header className="absolute inset-x-0 top-0 z-[100] bg-gradient-to-b from-black/35 to-transparent">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-xl font-bold text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.4)]">
            {t('common.appName')}
          </span>
          <nav className="flex items-center gap-4 text-sm">
            {/* locale switcher */}
            <div className="flex gap-2 text-white/80">
              {LOCALES.map((l) => (
                <Link key={l} href="/" locale={l} className={l === locale ? 'font-bold text-white' : ''}>
                  {l.toUpperCase()}
                </Link>
              ))}
            </div>
            <Link href="/auth" className="text-white/90">
              {t('common.signIn')}
            </Link>
            <Link
              href="/auth"
              className="rounded-lg bg-white/95 px-4 py-2 font-medium text-brand-600 shadow-sm"
            >
              {t('common.register')}
            </Link>
          </nav>
        </div>
      </header>

      {/* the journey — hero and closing UI are server-rendered children */}
      <LandingJourney hero={hero} hold={hold} captions={captions} scrollHint={t('home.journey.scrollHint')} />

      {/* why verification exists — the premise of the whole product. "How it
          works" below describes the mechanics; a first-time visitor needs the
          stakes before the mechanics mean anything. Claims here are limited to
          what the verification engine actually does (Plan §4), and whyFooter
          keeps the promise honest: a documentary check is not legal advice. */}
      <section className="border-b border-gray-100">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
            {t('home.whyEyebrow')}
          </p>
          <h2 className="mt-2 max-w-3xl text-3xl font-bold tracking-tight">{t('home.whyTitle')}</h2>
          <p className="mt-4 max-w-3xl text-gray-600">{t('home.whyBody')}</p>

          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 sm:grid-cols-3">
            {(['deed', 'seller', 'stale'] as const).map((risk) => (
              <div key={risk} className="bg-white p-6">
                <p className="text-sm font-medium text-gray-400">
                  {t(`home.risk.${risk}.question`)}
                </p>
                <p className="mt-3 font-semibold text-brand-600">
                  {t(`home.risk.${risk}.answerTitle`)}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
                  {t(`home.risk.${risk}.answerBody`)}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-3xl text-sm text-gray-500">{t('home.whyFooter')}</p>
        </div>
      </section>

      {/* regions — live list when the API answers, the six slugs otherwise */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold">{t('home.browseByRegion')}</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {regions.map((r) => (
            <Link
              key={r.slug}
              href={`/region/${r.slug}`}
              className="rounded-xl border border-gray-200 p-6 font-medium transition hover:border-brand-500 hover:shadow-sm"
            >
              {regionName(r)}
            </Link>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-bold">{t('home.howItWorks')}</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {(['step1', 'step2', 'step3'] as const).map((step) => (
              <div key={step} className="rounded-xl bg-white p-6 shadow-sm">
                <h3 className="font-semibold text-brand-600">{t(`home.${step}Title`)}</h3>
                <p className="mt-2 text-sm text-gray-600">{t(`home.${step}Body`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-100 py-8 text-center text-sm text-gray-400">
        {t('common.appName')} — {t('common.tagline')}
      </footer>
    </main>
  );
}
