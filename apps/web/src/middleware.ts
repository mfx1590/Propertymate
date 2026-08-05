import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

/** Opaque per-browser id behind the §8 co-visitation recommender. */
const SESSION_COOKIE = 'pv_sid';
const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

export default function middleware(request: NextRequest) {
  const response = intlMiddleware(request);

  // Signed-out browsing is most of a portal's traffic, so "viewers of X also
  // viewed Y" needs a stable browser id to group views by. It is a random
  // opaque value — no personal data, and never placed in a URL (§11 privacy).
  if (!request.cookies.get(SESSION_COOKIE)) {
    response.cookies.set(SESSION_COOKIE, crypto.randomUUID(), {
      maxAge: SESSION_MAX_AGE,
      sameSite: 'lax',
      httpOnly: true,
      path: '/',
    });
  }

  return response;
}

export const config = {
  // all paths except api routes, next internals and static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
