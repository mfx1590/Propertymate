'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Money } from './Money';

/**
 * Instalment calculator for a listing (Plan §6.1 "Calculators: mortgage/
 * instalment").
 *
 * Framed as instalments rather than a mortgage on purpose. TRNC purchases by
 * overseas buyers are overwhelmingly cash or developer terms — a UK-style
 * mortgage quote would imply financing this platform cannot arrange and no
 * lender here has offered. What a buyer genuinely needs is the shape of a
 * payment: deposit now, then N months at X.
 *
 * Everything is computed in GBP, the currency listings are priced in, and
 * rendered through <Money> so it follows the display-currency switcher.
 */

/** Standard amortisation. Zero-rate falls back to a straight division. */
function monthlyPayment(principal: number, annualRatePct: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function AffordabilityCalculator({ priceGbp }: { priceGbp: number }) {
  const t = useTranslations('calculator');
  const [depositPct, setDepositPct] = useState(30);
  const [years, setYears] = useState(5);
  const [ratePct, setRatePct] = useState(0);
  const [open, setOpen] = useState(false);

  const { deposit, financed, monthly, totalPaid, interest } = useMemo(() => {
    const dep = (priceGbp * depositPct) / 100;
    const fin = Math.max(0, priceGbp - dep);
    const months = years * 12;
    const m = monthlyPayment(fin, ratePct, months);
    const paid = dep + m * months;
    return { deposit: dep, financed: fin, monthly: m, totalPaid: paid, interest: paid - priceGbp };
  }, [priceGbp, depositPct, years, ratePct]);

  if (!(priceGbp > 0)) return null;

  return (
    <section className="mt-6 rounded-xl border border-gray-200 p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="font-semibold">{t('title')}</span>
        <span className="text-sm text-brand-600">{open ? t('hide') : t('show')}</span>
      </button>

      {open && (
        <>
          <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field
              label={t('depositPct')}
              value={depositPct}
              onChange={setDepositPct}
              min={0}
              max={100}
              step={5}
              suffix="%"
            />
            <Field label={t('years')} value={years} onChange={setYears} min={1} max={25} step={1} />
            <Field
              label={t('ratePct')}
              value={ratePct}
              onChange={setRatePct}
              min={0}
              max={25}
              step={0.5}
              suffix="%"
            />
          </div>

          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            <Stat label={t('deposit')} value={<Money gbp={deposit} />} />
            <Stat label={t('financed')} value={<Money gbp={financed} />} />
            <Stat
              label={t('monthly')}
              value={<Money gbp={monthly} />}
              emphasis
              hint={t('overMonths', { count: years * 12 })}
            />
            <Stat
              label={t('totalPaid')}
              value={<Money gbp={totalPaid} />}
              hint={ratePct > 0 ? t('ofWhichInterest') : undefined}
              hintValue={ratePct > 0 ? <Money gbp={interest} /> : undefined}
            />
          </dl>

          {/* Say plainly what this is not. */}
          <p className="mt-4 text-xs text-gray-400">{t('disclaimer')}</p>
        </>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            // Clamp rather than reject: a slip that produced a negative
            // deposit would otherwise render a nonsense schedule.
            onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);
          }}
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        {suffix && <span className="text-sm text-gray-400">{suffix}</span>}
      </div>
    </label>
  );
}

function Stat({
  label,
  value,
  hint,
  hintValue,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  hintValue?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 ${emphasis ? 'bg-brand-50' : 'bg-gray-50'}`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`mt-0.5 font-bold ${emphasis ? 'text-xl text-brand-700' : 'text-lg text-gray-900'}`}>
        {value}
      </dd>
      {hint && (
        <p className="mt-0.5 text-xs text-gray-500">
          {hint} {hintValue}
        </p>
      )}
    </div>
  );
}
