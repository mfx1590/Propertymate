import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://propertymate.tech';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Nothing behind sign-in should be crawled: it is per-account, it is
      // never useful in a search result, and /auth would only ever produce
      // duplicate thin pages.
      disallow: ['/dashboard', '/auth', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
