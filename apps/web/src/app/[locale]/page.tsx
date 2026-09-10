import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES } from '@propverify/shared';
import { API_BASE } from '../../lib/listings';
import { Link } from '../../i18n/routing';
import { landingUrl } from '../../components/landing/media';
import { Reveal } from '../../components/landing/Reveal';
import { CountUp } from '../../components/landing/CountUp';
import { VerifySequence } from '../../components/landing/VerifySequence';
import s from '../../components/landing/landing.module.css';

/**
 * The homepage — "dusk over the north coast".
 *
 * A scroll-based editorial landing: cinematic imagery (media bucket,
 * `landing/`), Playfair Display headlines, a pinned verification sequence.
 * Every job of the old page is intact and server-rendered — h1, search,
 * region links, trust pitch, how-it-works — and every animation is
 * progressive enhancement over that complete HTML.
 */

/** Fallback when the API is unreachable — notably CI's API-less build. */
const REGION_SLUGS = ['kyrenia', 'famagusta', 'iskele', 'nicosia', 'guzelyurt', 'lefke'] as const;

interface Region {
  slug: string;
  nameI18n: Record<string, string>;
}

/** Rendered on demand and cached five minutes, like every public page. */
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

  /** Catalogue name first (dual EN/TR forms, fixed RU/FA), API as fallback. */
  const regionName = (r: Region) => {
    try {
      const fromCatalogue = t(`regionPage.names.${r.slug}`);
      if (fromCatalogue && !fromCatalogue.startsWith('regionPage.')) return fromCatalogue;
    } catch {
      /* not one of the six top-level regions */
    }
    return r.nameI18n[locale] || r.nameI18n.en || r.slug;
  };

  const stats = [
    { value: 6, label: t('home.stats.regions') },
    { value: 4, label: t('home.stats.deeds') },
    { value: 90, label: t('home.stats.days') },
  ];

  return (
    <main className={s.root}>
      {/* ---- header, floating over the hero ---- */}
      <header className="absolute inset-x-0 top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <span className={`${s.serif} text-xl font-bold`} style={{ color: 'var(--dark-text)' }}>
            {t('common.appName')}
          </span>
          <nav className="flex items-center gap-5 text-sm">
            <div className="hidden gap-3 sm:flex" style={{ color: 'var(--muted-on-dark)' }}>
              {LOCALES.map((l) => (
                <Link
                  key={l}
                  href="/"
                  locale={l}
                  className={l === locale ? 'font-bold' : ''}
                  style={l === locale ? { color: 'var(--gold)' } : undefined}
                >
                  {l.toUpperCase()}
                </Link>
              ))}
            </div>
            <Link href="/auth" style={{ color: 'var(--dark-text)' }}>
              {t('common.signIn')}
            </Link>
            <Link href="/auth" className={`${s.goldBtn} rounded-full px-5 py-2 text-sm`}>
              {t('common.register')}
            </Link>
          </nav>
        </div>
      </header>

      {/* ---- hero ---- */}
      <section className={s.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
        <img
          src={landingUrl('hero-coast.webp')}
          alt=""
          className={s.heroImg}
          fetchPriority="high"
          decoding="async"
        />
        <div className={s.heroScrim} />
        <div className={s.grain} />

        <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-end px-5 pb-28 pt-32">
          <div className="max-w-2xl">
            <p className={s.kicker}>{t('home.heroKicker')}</p>
            <h1
              className={`${s.serif} mt-5 text-[2.6rem] font-semibold leading-[1.08] sm:text-6xl`}
              style={{ color: 'var(--dark-text)' }}
            >
              {t('home.heroTitle')}
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed" style={{ color: 'var(--muted-on-dark)' }}>
              {t('home.heroSubtitle')}
            </p>

            <form action={`/${locale}/search`} className={`${s.heroSearch} mt-9 flex max-w-xl gap-2 rounded-2xl p-2`}>
              <input
                name="q"
                className="w-full rounded-xl bg-transparent px-4 py-3 outline-none"
                style={{ color: 'var(--dark-text)' }}
                placeholder={t('home.searchPlaceholder')}
              />
              <button type="submit" className={`${s.goldBtn} shrink-0 rounded-xl px-6 py-3`}>
                {t('common.search')}
              </button>
            </form>

            <div className="mt-7 flex flex-wrap gap-x-7 gap-y-2.5">
              <span className={s.chip}>{t('home.check.deed')}</span>
              <span className={s.chip}>{t('home.check.seller')}</span>
              <span className={s.chip}>{t('home.check.fresh')}</span>
            </div>
          </div>
        </div>
        <div className={s.scrollCue} aria-hidden />
      </section>

      {/* ---- stats band ---- */}
      <section style={{ background: 'var(--ink)', color: 'var(--dark-text)' }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:grid-cols-3">
          {stats.map((st, i) => (
            <Reveal key={i} delay={i * 120}>
              <div
                className="sm:px-6"
                style={i > 0 ? { borderInlineStart: '1px solid var(--hairline-dark)' } : undefined}
              >
                <p className={`${s.serif} text-5xl font-semibold`} style={{ color: 'var(--gold)' }}>
                  <CountUp value={st.value} />
                </p>
                <p className="mt-3 max-w-[16rem] text-sm leading-relaxed" style={{ color: 'var(--muted-on-dark)' }}>
                  {st.label}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- why verification exists: the pinned sequence. Claims stay
              limited to what the engine actually does (Plan §4); the honest
              footnote rides with the closing CTA below. ---- */}
      <VerifySequence
        eyebrow={t('home.whyEyebrow')}
        title={t('home.whyTitle')}
        body={t('home.whyBody')}
        stamp={t('home.stamp')}
        thumbSrc={landingUrl('region-kyrenia.webp')}
        stages={[
          {
            question: t('home.risk.deed.question'),
            answerTitle: t('home.risk.deed.answerTitle'),
            answerBody: t('home.risk.deed.answerBody'),
            checkLabel: t('home.check.deed'),
            chip: t('search.deed.turkish'),
          },
          {
            question: t('home.risk.seller.question'),
            answerTitle: t('home.risk.seller.answerTitle'),
            answerBody: t('home.risk.seller.answerBody'),
            checkLabel: t('home.check.seller'),
          },
          {
            question: t('home.risk.stale.question'),
            answerTitle: t('home.risk.stale.answerTitle'),
            answerBody: t('home.risk.stale.answerBody'),
            checkLabel: t('home.check.fresh'),
          },
        ]}
      />

      {/* ---- visual breather: the terrace ---- */}
      <section className={s.band} style={{ height: 'min(58vh, 560px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
        <img src={landingUrl('band-terrace.webp')} alt="" className={s.bandImg} loading="lazy" decoding="async" />
      </section>

      {/* ---- regions ---- */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <Reveal>
          <h2 className={`${s.serif} text-3xl font-semibold sm:text-4xl`}>{t('home.browseByRegion')}</h2>
          <p className="mt-3 max-w-xl" style={{ color: 'var(--muted-on-paper)' }}>
            {t('home.regionsSub')}
          </p>
        </Reveal>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {regions.map((r, i) => (
            <Reveal key={r.slug} delay={(i % 3) * 100}>
              <Link href={`/region/${r.slug}`} className={s.regionCard}>
                {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
                <img src={landingUrl(`region-${r.slug}.webp`)} alt="" loading="lazy" decoding="async" />
                <span className={s.regionName}>
                  <span className={`${s.serif} text-xl font-semibold`}>{regionName(r)}</span>
                  <span aria-hidden style={{ color: 'var(--gold)' }}>
                    →
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---- how it works ---- */}
      <section style={{ background: 'var(--cream-2)' }}>
        <div className="mx-auto max-w-6xl px-5 py-24">
          <Reveal>
            <h2 className={`${s.serif} text-3xl font-semibold sm:text-4xl`}>{t('home.howItWorks')}</h2>
          </Reveal>
          <div className="mt-12 grid gap-10 sm:grid-cols-3">
            {(['step1', 'step2', 'step3'] as const).map((step, i) => (
              <Reveal key={step} delay={i * 130}>
                <div style={{ borderTop: '1px solid var(--hairline-paper)' }} className="pt-6">
                  <p className={s.stepNum}>{String(i + 1).padStart(2, '0')}</p>
                  <h3 className="mt-4 text-lg font-semibold">{t(`home.${step}Title`)}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'var(--muted-on-paper)' }}>
                    {t(`home.${step}Body`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- closing CTA: the doorway ---- */}
      <section className={s.cta}>
        {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
        <img src={landingUrl('cta-doorway.webp')} alt="" className={s.bandImg} loading="lazy" decoding="async" />
        <div className={s.ctaScrim} />
        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center px-5 py-36 text-center">
          <Reveal>
            <h2 className={`${s.serif} text-3xl font-semibold leading-tight sm:text-5xl`}>
              {t('home.ctaTitle')}
            </h2>
            <div className="mt-9">
              <Link href="/search" className={`${s.goldBtn} inline-block rounded-full px-8 py-3.5`}>
                {t('home.ctaButton')}
              </Link>
            </div>
            <p className="mx-auto mt-10 max-w-xl text-xs leading-relaxed" style={{ color: 'var(--muted-on-dark)' }}>
              {t('home.whyFooter')}
            </p>
          </Reveal>
        </div>
      </section>

      <footer style={{ background: 'var(--ink)', borderTop: '1px solid var(--hairline-dark)' }}>
        <div
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm"
          style={{ color: 'var(--muted-on-dark)' }}
        >
          <span className={s.serif}>{t('common.appName')}</span>
          <span>{t('common.tagline')}</span>
        </div>
      </footer>
    </main>
  );
}
