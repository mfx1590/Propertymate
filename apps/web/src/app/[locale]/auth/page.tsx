'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiPost, setTokens } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { useRouter } from '../../../i18n/routing';
import type { TokenPair } from '../../../lib/types';

type Tab = 'phone' | 'email';

export default function AuthPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { refreshMe } = useAuth();
  const [tab, setTab] = useState<Tab>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // phone flow
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  // email flow
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const requestCode = () =>
    run(async () => {
      const res = await apiPost<{ sent: boolean; devCode?: string }>('/auth/otp/request', { phone });
      setCodeSent(true);
      setDevCode(res.devCode ?? null);
    });

  const finishAuth = async (tokens: TokenPair) => {
    setTokens(tokens);
    await refreshMe();
    router.push('/dashboard');
  };

  const verifyCode = () =>
    run(async () => {
      await finishAuth(await apiPost<TokenPair>('/auth/otp/verify', { phone, code }));
    });

  const submitEmail = () =>
    run(async () => {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      await finishAuth(await apiPost<TokenPair>(path, { email, password }));
    });

  const inputCls = 'w-full rounded-lg border border-gray-300 px-4 py-3';
  const buttonCls =
    'w-full rounded-lg bg-brand-600 px-4 py-3 font-medium text-white disabled:opacity-50';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-center text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-center text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-8 flex rounded-lg border border-gray-200 p-1 text-sm font-medium">
        {(['phone', 'email'] as const).map((k) => (
          <button
            key={k}
            className={`flex-1 rounded-md py-2 ${tab === k ? 'bg-brand-600 text-white' : 'text-gray-600'}`}
            onClick={() => setTab(k)}
          >
            {t(`tab.${k}`)}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {tab === 'phone' ? (
          !codeSent ? (
            <>
              <input
                className={inputCls}
                dir="ltr"
                placeholder={t('phonePlaceholder')}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <button className={buttonCls} disabled={busy || !phone} onClick={requestCode}>
                {t('sendCode')}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">{t('codeSentTo', { phone })}</p>
              {devCode && (
                <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                  {t('devCodeHint')}: <b>{devCode}</b>
                </p>
              )}
              <input
                className={inputCls}
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                placeholder="······"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button className={buttonCls} disabled={busy || code.length !== 6} onClick={verifyCode}>
                {t('verify')}
              </button>
              <button className="w-full text-sm text-gray-500" onClick={() => setCodeSent(false)}>
                {t('changePhone')}
              </button>
            </>
          )
        ) : (
          <>
            <input
              className={inputCls}
              dir="ltr"
              type="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className={inputCls}
              dir="ltr"
              type="password"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className={buttonCls} disabled={busy || !email || !password} onClick={submitEmail}>
              {mode === 'login' ? t('signIn') : t('register')}
            </button>
            <button
              className="w-full text-sm text-gray-500"
              onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? t('switchToRegister') : t('switchToLogin')}
            </button>
          </>
        )}

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}
