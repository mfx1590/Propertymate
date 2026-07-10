'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '../../../lib/auth';
import { menuForRoles } from '../../../modules/registry';
import { Link, useRouter, usePathname } from '../../../i18n/routing';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('dashboard');
  const { me, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !me) router.replace('/auth');
  }, [loading, me, router]);

  if (loading || !me) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">…</div>;
  }

  const menu = menuForRoles(me.userRoles.map((ur) => ur.role.key));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-e border-gray-200 bg-gray-50 p-4">
        <Link href="/" className="px-2 text-lg font-bold text-brand-600">
          {t('appName')}
        </Link>
        <nav className="mt-6 flex flex-col gap-1">
          {menu.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm ${
                pathname === item.href
                  ? 'bg-brand-600 font-medium text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {t(`menu.${item.labelKey}`)}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-gray-200 pt-4">
          <p className="truncate px-2 text-xs text-gray-500">{me.email ?? me.phone}</p>
          <button
            className="mt-2 w-full rounded-md px-3 py-2 text-start text-sm text-gray-600 hover:bg-gray-100"
            onClick={() => {
              signOut();
              router.push('/');
            }}
          >
            {t('signOut')}
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
