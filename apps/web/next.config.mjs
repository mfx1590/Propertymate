import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // self-contained server bundle so the runtime image needs no node_modules
  output: 'standalone',
  // the monorepo root, not apps/web — standalone has to trace workspace deps
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  transpilePackages: ['@propverify/shared', '@propverify/ui'],
};

export default withNextIntl(nextConfig);
