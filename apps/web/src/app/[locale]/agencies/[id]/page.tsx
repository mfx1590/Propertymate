import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { API_BASE } from '../../../../lib/listings';
import type { PublicAgency } from '../../../../lib/team';

async function fetchAgency(id: string): Promise<PublicAgency | null> {
  const res = await fetch(`${API_BASE}/agencies/${id}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({
  params,
}: {
  params: { id: string; locale: string };
}): Promise<Metadata> {
  const a = await fetchAgency(params.id);
  if (!a) return { title: 'Agency not found' };
  return {
    title: `${a.companyName} — PropVerify`,
    description: (a.about ?? '').slice(0, 160),
  };
}

export default async function AgencyPage({
  params: { id, locale },
}: {
  params: { id: string; locale: string };
}) {
  setRequestLocale(locale);
  const t = await getTranslations('team');
  const a = await fetchAgency(id);
  if (!a) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    name: a.companyName,
    description: (a.about ?? '').slice(0, 500),
    ...(a.logoUrl ? { logo: a.logoUrl } : {}),
    ...(a.address ? { address: { '@type': 'PostalAddress', streetAddress: a.address } } : {}),
    numberOfEmployees: a.totals.members,
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {a.logoUrl || a.avatarUrl ? (
          <img
            src={(a.logoUrl ?? a.avatarUrl)!}
            alt={a.companyName}
            className="h-20 w-20 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-3xl">
            🏢
          </div>
        )}
        <div className="min-w-0">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            ✓ {t('publicVerified')}
          </span>
          <h1 className="mt-2 text-3xl font-bold">{a.companyName}</h1>
          {a.address && <p className="text-gray-500">{a.address}</p>}
        </div>
      </div>

      {a.about && <p className="mt-6 whitespace-pre-line text-gray-700">{a.about}</p>}

      <dl className="mt-6 grid grid-cols-3 gap-4 rounded-xl border border-gray-200 p-5">
        {(
          [
            [t('totalMembers'), a.totals.members],
            [t('salesClosed'), a.totals.salesClosed],
            [t('rentalsClosed'), a.totals.rentalsClosed],
          ] as Array<[string, number]>
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-gray-400">{k}</dt>
            <dd className="text-2xl font-bold">{v}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-8 text-lg font-semibold">{t('ourTeam')}</h2>
      {a.members.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">{t('noPublicMembers')}</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {a.members.map((m) => (
            <li key={m.userId} className="flex gap-3 rounded-xl border border-gray-200 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {m.avatarUrl ? (
                <img src={m.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100">
                  👤
                </div>
              )}
              <div className="min-w-0">
                {m.bio && <p className="text-sm text-gray-700">{m.bio}</p>}
                <p className="mt-1 text-xs text-gray-500">
                  {m.salesClosed} {t('salesClosed')} · {m.rentalsClosed} {t('rentalsClosed')}
                  {m.ratingAvg !== null && ` · ★ ${m.ratingAvg.toFixed(1)}`}
                </p>
                {m.regions.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400">{m.regions.join(', ')}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 text-xs text-gray-400">{t('publicContactNote')}</p>
    </main>
  );
}
