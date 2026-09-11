/**
 * Landing imagery lives in the public media bucket under `landing/` — never
 * in git. In production the base is `${NEXT_PUBLIC_API_URL}/media` (Caddy
 * proxies it to the bucket); locally MinIO serves the same shape on its own
 * port, hence the override.
 */
export const MEDIA_BASE =
  process.env.NEXT_PUBLIC_MEDIA_URL ??
  `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/media`;

export const landingUrl = (file: string): string => `${MEDIA_BASE}/landing/${file}`;
