import type { MetadataRoute } from 'next';
import { LOCALES } from '@propverify/shared';
import { API_BASE } from '../lib/listings';

/**
 * Sitemap (Plan §6.1 SEO).
 *
 * Region landing pages and live listings, in all four locales. Without this
 * nothing links the landing pages except the homepage footer, and a crawler
 * has no way to discover a listing that has scrolled off the first page of
 * results.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://propertymate.tech';

const REGION_SLUGS = ['kyrenia', 'famagusta', 'iskele', 'nicosia', 'guzelyurt', 'lefke'];

/** Alternates tell Google these are the same page in different languages. */
function withAlternates(path: string) {
  return {
    languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE_URL}/${l}${path}`])),
  };
}

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPaths = ['', '/search', '/compare', '/lawyers'];

  const entries: MetadataRoute.Sitemap = [];

  for (const locale of LOCALES) {
    for (const path of staticPaths) {
      entries.push({
        url: `${SITE_URL}/${locale}${path}`,
        changeFrequency: path === '' ? 'weekly' : 'daily',
        priority: path === '' ? 1 : 0.8,
        alternates: withAlternates(path),
      });
    }
    for (const slug of REGION_SLUGS) {
      entries.push({
        url: `${SITE_URL}/${locale}/region/${slug}`,
        changeFrequency: 'daily',
        priority: 0.9,
        alternates: withAlternates(`/region/${slug}`),
      });
    }
  }

  // Listings change constantly, so a failure here must not take the whole
  // sitemap down — the static and region entries are the valuable half.
  try {
    const res = await fetch(`${API_BASE}/search/listings?sort=newest&page=1`, {
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const json = (await res.json()) as { hits?: { id: string }[] };
      for (const hit of json.hits ?? []) {
        for (const locale of LOCALES) {
          entries.push({
            url: `${SITE_URL}/${locale}/listing/${hit.id}`,
            changeFrequency: 'weekly',
            priority: 0.7,
            alternates: withAlternates(`/listing/${hit.id}`),
          });
        }
      }
    }
  } catch {
    /* sitemap still serves the pages we know statically */
  }

  return entries;
}
