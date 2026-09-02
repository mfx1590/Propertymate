'use client';

import { useMoney } from '../lib/currency';

/**
 * A GBP amount rendered in the viewer's chosen display currency.
 *
 * A client component so it can be dropped into server-rendered pages: the
 * listing page is SSR for SEO, and the canonical price stays in the HTML while
 * the conversion is progressive enhancement on top.
 *
 * First render is always GBP — the provider only reads the stored choice in an
 * effect — so the server and client markup agree and there is no hydration
 * mismatch.
 */
export function Money({ gbp, className }: { gbp: number; className?: string }) {
  const { format } = useMoney();
  return <span className={className}>{format(gbp)}</span>;
}
