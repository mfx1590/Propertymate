'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Money } from './Money';
import type { PaymentPlan, ProjectUnit } from '../lib/projects';

/**
 * Developer payment plans as real schedule tables (Plan §6.1).
 *
 * The project page already listed plans as a summary — "30% down · 24 monthly
 * · 40% on delivery" — which tells a buyer the shape of the deal but not what
 * they actually pay or when. Off-plan is a large share of the TRNC market and
 * the terms are how those units sell, so this resolves a plan against a real
 * unit price and the delivery date into dated rows.
 */

interface Row {
  label: string;
  due: Date | null;
  amount: number;
}

/** A plan's parts must account for the whole price; the middle is the remainder. */
function installmentPct(plan: PaymentPlan): number {
  return 100 - (plan.downPaymentPct ?? 0) - (plan.onDeliveryPct ?? 0);
}

function buildRows(
  plan: PaymentPlan,
  priceGbp: number,
  deliveryDate: Date | null,
  labels: { down: string; installment: string; onDelivery: string },
): Row[] {
  const rows: Row[] = [];
  const today = new Date();
  const stepMonths = plan.installmentFrequency === 'quarterly' ? 3 : 1;

  const downPct = plan.downPaymentPct ?? 0;
  if (downPct > 0) {
    rows.push({ label: labels.down, due: today, amount: (priceGbp * downPct) / 100 });
  }

  const midPct = installmentPct(plan);
  const n = plan.installments ?? 0;
  if (n > 0 && midPct > 0) {
    const each = (priceGbp * midPct) / 100 / n;
    for (let i = 1; i <= n; i++) {
      const due = new Date(today);
      due.setMonth(due.getMonth() + i * stepMonths);
      rows.push({ label: `${labels.installment} ${i}/${n}`, due, amount: each });
    }
  }

  const deliveryPct = plan.onDeliveryPct ?? 0;
  if (deliveryPct > 0) {
    rows.push({
      label: labels.onDelivery,
      due: deliveryDate,
      amount: (priceGbp * deliveryPct) / 100,
    });
  }

  // Chronological, so the table reads as a timeline rather than in the order
  // the plan happens to describe its parts. Undated rows (no delivery date on
  // the project yet) sort last.
  return rows.sort((a, b) => {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due.getTime() - b.due.getTime();
  });
}

/**
 * True when the instalments run past handover. That is not a rendering
 * problem — it means the plan and the delivery date disagree, and a buyer
 * comparing them deserves to be told rather than left to spot it.
 */
function overrunsDelivery(rows: Row[], deliveryDate: Date | null): boolean {
  if (!deliveryDate) return false;
  return rows.some((r) => r.due && r.due > deliveryDate);
}

export function PaymentSchedule({
  plans,
  units,
  deliveryDate,
}: {
  plans: PaymentPlan[];
  units: ProjectUnit[];
  deliveryDate: string | null;
}) {
  const t = useTranslations('paymentSchedule');
  const locale = useLocale();

  // Default to the cheapest available unit: it is the number a browsing buyer
  // is trying to find, and it makes the table meaningful without any input.
  const sellable = useMemo(
    () =>
      units
        .filter((u) => u.status === 'available' && Number(u.priceAmount) > 0)
        .sort((a, b) => Number(a.priceAmount) - Number(b.priceAmount)),
    [units],
  );

  const [unitId, setUnitId] = useState<string>(() => sellable[0]?.id ?? '');
  const [planIdx, setPlanIdx] = useState(0);
  const [open, setOpen] = useState(false);

  const unit = sellable.find((u) => u.id === unitId) ?? sellable[0];
  const plan = plans[planIdx] ?? plans[0];
  const price = unit ? Number(unit.priceAmount) : 0;
  const delivery = deliveryDate ? new Date(deliveryDate) : null;

  const rows = useMemo(
    () =>
      plan && price > 0
        ? buildRows(plan, price, delivery, {
            down: t('rows.down'),
            installment: t('rows.installment'),
            onDelivery: t('rows.onDelivery'),
          })
        : [],
    // `delivery` is derived from a string prop, so the string is the real input
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan, price, deliveryDate, t],
  );

  if (!plan || sellable.length === 0) return null;

  const mid = installmentPct(plan);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  // A plan whose parts exceed 100% would otherwise render negative
  // instalments. Say so rather than showing a schedule nobody can pay.
  const inconsistent = mid < 0;
  const overruns = overrunsDelivery(rows, delivery);

  return (
    <section className="mt-6 rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold">{t('title')}</h3>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-4 flex flex-wrap gap-3">
        {plans.length > 1 && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('planLabel')}
            </span>
            <select
              value={planIdx}
              onChange={(e) => setPlanIdx(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              {plans.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {sellable.length > 1 && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('unitLabel')}
            </span>
            <select
              value={unit?.id ?? ''}
              onChange={(e) => setUnitId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            >
              {sellable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitNo}
                  {u.bedrooms != null ? ` · ${u.bedrooms}bd` : ''} —{' '}
                  {new Intl.NumberFormat('en-GB', {
                    style: 'currency',
                    currency: u.priceCurrency || 'GBP',
                    maximumFractionDigits: 0,
                  }).format(Number(u.priceAmount))}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {inconsistent ? (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('inconsistent')}
        </p>
      ) : (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-4 text-sm font-medium text-brand-600"
          >
            {open ? t('hideSchedule') : t('showSchedule', { count: rows.length })}
          </button>

          {open && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[380px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2">{t('cols.payment')}</th>
                    <th className="py-2">{t('cols.due')}</th>
                    <th className="py-2 text-right">{t('cols.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5">{r.label}</td>
                      <td className="py-1.5 text-gray-500">
                        {r.due ? r.due.toLocaleDateString(locale, { month: 'short', year: 'numeric' }) : t('onCompletion')}
                      </td>
                      <td className="py-1.5 text-right font-medium">
                        <Money gbp={r.amount} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="pt-2" colSpan={2}>
                      {t('cols.total')}
                    </td>
                    <td className="pt-2 text-right">
                      <Money gbp={total} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {overruns && (
            <p className="mt-3 rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {t('overrunsDelivery')}
            </p>
          )}

          {/* Dates for anything after the deposit are indicative: the schedule
              anchors on today, and the real one starts when contracts sign. */}
          <p className="mt-3 text-xs text-gray-400">{t('disclaimer')}</p>
        </>
      )}
    </section>
  );
}
