import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES } from '@propverify/shared';
import { Link } from '../../i18n/routing';

const REGIONS = [
  { slug: 'kyrenia', en: 'Kyrenia (Girne)' },
  { slug: 'famagusta', en: 'Famagusta (Gazimağusa)' },
  { slug: 'iskele', en: 'İskele' },
  { slug: 'nicosia', en: 'Nicosia (Lefkoşa)' },
  { slug: 'guzelyurt', en: 'Güzelyurt' },
  { slug: 'lefke', en: 'Lefke' },
];

export default async function HomePage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <main>
      {/* header */}
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-xl font-bold text-brand-600">{t('common.appName')}</span>
          <nav className="flex items-center gap-4 text-sm">
            {/* locale switcher */}
            <div className="flex gap-2 text-gray-500">
              {LOCALES.map((l) => (
                <Link key={l} href="/" locale={l} className={l === locale ? 'font-bold text-brand-600' : ''}>
                  {l.toUpperCase()}
                </Link>
              ))}
            </div>
            <span className="cursor-pointer text-gray-700">{t('common.signIn')}</span>
            <span className="cursor-pointer rounded-lg bg-brand-600 px-4 py-2 font-medium text-white">
              {t('common.register')}
            </span>
          </nav>
        </div>
      </header>

      {/* hero */}
      <section className="bg-brand-50">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
            {t('home.heroTitle')}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">{t('home.heroSubtitle')}</p>
          <div className="mx-auto mt-8 flex max-w-xl gap-2">
            <input
              className="w-full rounded-lg border border-gray-300 px-4 py-3"
              placeholder={t('home.searchPlaceholder')}
            />
            <button className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white">
              {t('common.search')}
            </button>
          </div>
        </div>
      </section>

      {/* regions */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold">{t('home.browseByRegion')}</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {REGIONS.map((r) => (
            <div
              key={r.slug}
              className="rounded-xl border border-gray-200 p-6 font-medium transition hover:border-brand-500 hover:shadow-sm"
            >
              {r.en}
            </div>
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
