import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { API_BASE, type RegionInfo } from '../../../../lib/listings';
import { Link } from '../../../../i18n/routing';

interface LawyerProfile {
  userId: string;
  name: string;
  bio: string | null;
  regions: string[];
  languages: string[];
  feeModel: string | null;
  feeNote: string | null;
  engagementCount: number;
}

async function fetchLawyer(id: string): Promise<LawyerProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/lawyers/${id}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params: { id, locale },
}: {
  params: { id: string; locale: string };
}): Promise<Metadata> {
  const l = await fetchLawyer(id);
  if (!l) return { title: 'Not found' };
  const t = await getTranslations({ locale, namespace: 'legal' });
  return { title: `${l.name} — ${t('directory.metaTitle')}`, description: l.bio ?? undefined };
}

export default async function LawyerProfilePage({
  params: { id, locale },
}: {
  params: { id: string; locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations('legal');
  const l = await fetchLawyer(id);
  if (!l) notFound();

  let regions: RegionInfo[] = [];
  try {
    const res = await fetch(`${API_BASE}/regions`, { next: { revalidate: 3600 } });
    if (res.ok) regions = await res.json();
  } catch {
    regions = [];
  }
  const regionName = (slug: string) => regions.find((r) => r.slug === slug)?.nameI18n[locale] ?? slug;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/lawyers" className="text-sm text-brand-600">
        ← {t('directory.title')}
      </Link>

      <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
          ✓ {t('directory.verified')}
        </span>
        {l.engagementCount > 0 && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
            {t('directory.engagements', { count: l.engagementCount })}
          </span>
        )}
      </div>

      <h1 className="mt-2 text-3xl font-bold">{l.name}</h1>
      {l.bio && <p className="mt-4 whitespace-pre-line text-gray-700">{l.bio}</p>}

      <dl className="mt-8 grid gap-5 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-400">{t('profile.regions')}</dt>
          <dd className="mt-1 text-sm">
            {l.regions.length ? l.regions.map(regionName).join(', ') : t('allRegions')}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-400">{t('profile.languages')}</dt>
          <dd className="mt-1 text-sm">
            {l.languages.length ? l.languages.map((x) => t(`languages.${x}`)).join(' · ') : '—'}
          </dd>
        </div>
        {l.feeModel && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-400">{t('profile.feeModel')}</dt>
            <dd className="mt-1 text-sm">{t(`feeModels.${l.feeModel}`)}</dd>
          </div>
        )}
        {l.feeNote && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-400">{t('profile.feeNote')}</dt>
            <dd className="mt-1 text-sm">{l.feeNote}</dd>
          </div>
        )}
      </dl>

      {/* No "contact" button on purpose: a lawyer is engaged from inside a
          deal, at a stage that allows one, so that the engagement, its scope
          and its fee are on the record rather than in someone's inbox. */}
      <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50/60 p-5">
        <p className="font-semibold text-gray-800">{t('profile.howToEngage')}</p>
        <p className="mt-1 text-sm text-gray-500">{t('profile.howToEngageBody')}</p>
      </div>

      <p className="mt-6 text-sm text-gray-400">{t('directory.disclaimer')}</p>
    </main>
  );
}
