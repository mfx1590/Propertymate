import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import { LOCALES, RTL_LOCALES, type Locale } from '@propverify/shared';
import en from './messages/en.json';
import tr from './messages/tr.json';
import ru from './messages/ru.json';
import fa from './messages/fa.json';

/**
 * A deliberately small translator.
 *
 * The web uses next-intl, which has no React Native runtime. This app needs
 * lookup, interpolation and an RTL flag and nothing else, so it does those
 * three things rather than pulling in an i18n framework. Keys are dotted paths
 * into the same shape the web uses, so copy can be moved between the two.
 */
const CATALOGUES: Record<Locale, unknown> = { en, tr, ru, fa } as Record<Locale, unknown>;

function lookup(catalogue: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, catalogue);
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

function deviceLocale(): Locale {
  const tag = getLocales()[0]?.languageCode ?? 'en';
  return (LOCALES as readonly string[]).includes(tag) ? (tag as Locale) : 'en';
}

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  isRTL: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    // Flipping the whole app's layout direction needs a native reload to take
    // effect, so this only records the intent; screens read `isRTL` and align
    // themselves, which is enough for the text-heavy surfaces here.
    I18nManager.allowRTL(RTL_LOCALES.includes(next));
  }, []);

  const value = useMemo<I18nState>(() => {
    const t = (key: string, values?: Record<string, string | number>) =>
      // Fall back through English rather than rendering a raw key — the web
      // shipped exactly that bug once (Plan §0 step 10).
      interpolate(lookup(CATALOGUES[locale], key) ?? lookup(en, key) ?? key, values);
    return { locale, setLocale, isRTL: RTL_LOCALES.includes(locale), t };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Picks the caller's language out of an i18n JSON column, else English. */
export function pickI18n(map: Record<string, string> | null | undefined, locale: string): string {
  if (!map) return '';
  return map[locale] || map.en || Object.values(map)[0] || '';
}
