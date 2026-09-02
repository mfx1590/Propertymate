'use client';

import { useTranslations } from 'next-intl';
import { DISPLAY_CURRENCIES, useMoney, type DisplayCurrency } from '../lib/currency';

const SYMBOL: Record<DisplayCurrency, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
  TRY: '₺',
};

/**
 * Display-currency picker for the browsing surface (§6.1).
 *
 * Labelled as an approximation on purpose: TRNC property is priced and sold in
 * GBP, so a converted figure helps a foreign buyer judge scale without
 * pretending to be the price they will pay.
 */
export function CurrencySwitcher({ className = '' }: { className?: string }) {
  const t = useTranslations('currency');
  const { currency, setCurrency, isConverted } = useMoney();

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <label className="sr-only" htmlFor="currency-switcher">
        {t('label')}
      </label>
      <select
        id="currency-switcher"
        value={currency}
        onChange={(e) => setCurrency(e.target.value as DisplayCurrency)}
        className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
      >
        {DISPLAY_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {SYMBOL[c]} {c}
          </option>
        ))}
      </select>
      {isConverted && (
        <span className="text-xs text-gray-400" title={t('approxHint')}>
          {t('approx')}
        </span>
      )}
    </div>
  );
}
