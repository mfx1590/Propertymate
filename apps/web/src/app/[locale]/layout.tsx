import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { RTL_LOCALES, type Locale } from '@propverify/shared';
import { routing } from '../../i18n/routing';
import { AuthProvider } from '../../lib/auth';
import { CompareProvider } from '../../lib/compare';
import { CurrencyProvider } from '../../lib/currency';
import '../globals.css';

export const metadata: Metadata = {
  title: 'PropVerify — Verified Property in Northern Cyprus',
  description:
    'Every property, agent and developer document-verified. Buy, sell and rent with confidence in the TRNC.',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = RTL_LOCALES.includes(locale as Locale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>
            <CurrencyProvider>
              <CompareProvider>{children}</CompareProvider>
            </CurrencyProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
