import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // all paths except api routes, next internals and static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
