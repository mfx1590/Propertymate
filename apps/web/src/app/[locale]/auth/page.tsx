'use client';

import { useEffect, useState } from 'react';
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

  // account type — chosen once, at registration
  const [accountType, setAccountType] = useState('customer');

  // §8: an invite link carries ?ref=CODE. Read from the URL after hydration
  // rather than via useSearchParams — that hook opts the whole page out of
  // static generation, and this page is otherwise perfectly prerenderable.
  // It is only ever applied when the account is actually created.
  const [referralCode, setReferralCode] = useState<string | undefined>();
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) setReferralCode(ref.trim().toUpperCase());
  }, []);

  // phone flow
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  // email flow
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const ACCOUNT_TYPES = ['customer', 'owner', 'solo_agent', 'agency', 'developer'] as const;

  const accountTypeSelect = (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{t('accountTypeLabel')}</span>
      <select
        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-4 py-3"
        value={accountType}
        onChange={(e) => setAccountType(e.target.value)}
      >
        {ACCOUNT_TYPES.map((k) => (
          <option key={k} value={k}>
            {t(`accountTypes.${k}`)}
          </option>
        ))}
      </select>
    </label>
  );

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
      await finishAuth(await apiPost<TokenPair>('/auth/otp/verify', { phone, code, accountType, referralCode }));
    });

  const submitEmail = () =>
    run(async () => {
      const body =
        mode === 'login' ? { email, password } : { email, password, accountType, referralCode };
      await finishAuth(await apiPost<TokenPair>(mode === 'login' ? '/auth/login' : '/auth/register', body));
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
              {accountTypeSelect}
              <p className="text-xs text-gray-400">{t('accountTypeHint')}</p>
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
            {mode === 'register' && accountTypeSelect}
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
