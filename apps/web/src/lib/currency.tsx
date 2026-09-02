'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { API_BASE } from './listings';

/**
 * Display-currency switcher (Plan §6.1, §12 "multi-currency display").
 *
 * Two rules this deliberately follows:
 *
 * 1. **GBP is the truth.** Everything is stored, ranked and transacted in GBP.
 *    A converted figure is an aid to a foreign buyer, never the asking price —
 *    so converted output is prefixed `≈` and the GBP original stays available.
 * 2. **Browsing only.** Commissions, owner asks and agreed deal amounts are
 *    contractual and stay in GBP wherever they appear. Re-denominating a
 *    signed number at today's rate would imply a price nobody agreed to.
 */
export const DISPLAY_CURRENCIES = ['GBP', 'EUR', 'USD', 'TRY'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

const STORAGE_KEY = 'pv.displayCurrency';

interface FxPayload {
  base: string;
  fetchedAt: string | null;
  rates: Record<string, number>;
}

interface CurrencyState {
  currency: DisplayCurrency;
  setCurrency: (c: DisplayCurrency) => void;
  /** Format a GBP amount in the chosen currency. */
  format: (gbp: number) => string;
  /** True when the displayed figure is a conversion rather than the real price. */
  isConverted: boolean;
  ratesFetchedAt: string | null;
}

const CurrencyContext = createContext<CurrencyState | null>(null);

const fmt = (n: number, currency: string) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<DisplayCurrency>('GBP');
  const [fx, setFx] = useState<FxPayload | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && (DISPLAY_CURRENCIES as readonly string[]).includes(saved)) {
        setCurrencyState(saved as DisplayCurrency);
      }
    } catch {
      // private browsing or blocked storage — GBP is a fine default
    }
  }, []);

  useEffect(() => {
    // Only needed once a non-GBP currency is chosen, but fetched up front so
    // switching is instant rather than showing a flash of unconverted prices.
    fetch(`${API_BASE}/settings/fx-rates`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setFx)
      .catch(() => undefined);
  }, []);

  const setCurrency = useCallback((c: DisplayCurrency) => {
    setCurrencyState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<CurrencyState>(() => {
    const rate = currency === 'GBP' ? 1 : fx?.rates?.[currency];
    // Without a rate there is nothing honest to show but the real price.
    const usable = currency !== 'GBP' && typeof rate === 'number' && rate > 0;
    return {
      currency,
      setCurrency,
      isConverted: usable,
      ratesFetchedAt: fx?.fetchedAt ?? null,
      format: (gbp: number) =>
        usable ? `≈ ${fmt(gbp * (rate as number), currency)}` : fmt(gbp, 'GBP'),
    };
  }, [currency, fx, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * Safe outside the provider: falls back to GBP formatting rather than throwing,
 * so a server-rendered or standalone page cannot crash on it.
 */
export function useMoney(): CurrencyState {
  return (
    useContext(CurrencyContext) ?? {
      currency: 'GBP',
      setCurrency: () => {},
      format: (gbp: number) => fmt(gbp, 'GBP'),
      isConverted: false,
      ratesFetchedAt: null,
    }
  );
}
