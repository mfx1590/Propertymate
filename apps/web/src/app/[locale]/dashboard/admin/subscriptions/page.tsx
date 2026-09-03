'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { apiGet, apiPost, apiPut } from '../../../../../lib/api';

interface Plan {
  key: string;
  name: string;
  roleKey: string;
  priceAmount: number | null;
  currency: string | null;
  interval: string | null;
  priced: boolean;
}
interface Sub {
  id: string;
  userId: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  plan: { key: string; name: string };
}
interface LedgerEntry {
  id: string;
  planKey: string;
  listAmount: number;
  amount: number;
  currency: string;
  provider: string;
  providerRef: string | null;
  status: 'recorded' | 'waived' | 'reversal';
  note: string | null;
  occurredAt: string;
  reversesEntryId: string | null;
  user: { id: string; email: string | null; phone: string | null };
}
interface Ledger {
  entries: LedgerEntry[];
  totals: { currency: string; collected: number; foregone: number }[];
}

const CURRENCIES = ['GBP', 'EUR', 'USD', 'TRY'];

/**
 * Subscriptions are still admin-granted (§13.3, 2026-07-12) — what Phase 3
 * added is the money record: what each plan costs, what was actually collected
 * for each grant, and what was deliberately given away. The ledger below is
 * append-only; a wrong entry is reversed, never edited.
 */
export default function AdminSubscriptionsPage() {
  const t = useTranslations('adminSubs');
  const locale = useLocale();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [form, setForm] = useState({ identifier: '', planKey: '', months: '12' });
  const [pay, setPay] = useState({ on: false, amount: '', reference: '', note: '' });
  const [priceEdit, setPriceEdit] = useState<string | null>(null);
  const [priceForm, setPriceForm] = useState({ amount: '', currency: 'GBP', interval: 'month' });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, s, l] = await Promise.all([
      apiGet<Plan[]>('/plans'),
      apiGet<Sub[]>('/admin/subscriptions'),
      apiGet<Ledger>('/admin/payments'),
    ]);
    setPlans(p);
    setSubs(s);
    setLedger(l);
    setForm((f) => ({ ...f, planKey: f.planKey || p[0]?.key || '' }));
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);

  const selectedPlan = plans.find((p) => p.key === form.planKey);

  const grant = async () => {
    setError(null);
    setMsg(null);
    try {
      await apiPost('/admin/subscriptions/grant', {
        identifier: form.identifier,
        planKey: form.planKey,
        months: Number(form.months) || undefined,
        // Absent = a waived grant. The API records that explicitly rather than
        // treating no payment as no information.
        payment: pay.on
          ? {
              amount: Number(pay.amount) || 0,
              reference: pay.reference || undefined,
              note: pay.note || undefined,
            }
          : undefined,
      });
      setMsg(pay.on ? t('grantedPaid') : t('grantedWaived'));
      setForm((f) => ({ ...f, identifier: '' }));
      setPay({ on: false, amount: '', reference: '', note: '' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const revoke = async (id: string) => {
    await apiPost(`/admin/subscriptions/${id}/revoke`);
    await load();
  };

  const savePrice = async (key: string, clear: boolean) => {
    setError(null);
    try {
      await apiPut(
        `/admin/plans/${key}/price`,
        clear
          ? { priceAmount: null }
          : { priceAmount: Number(priceForm.amount), currency: priceForm.currency, interval: priceForm.interval },
      );
      setPriceEdit(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const reverse = async (id: string) => {
    setError(null);
    try {
      await apiPost(`/admin/payments/${id}/reverse`, { note: t('ledger.reversalNote') });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const statusCls: Record<LedgerEntry['status'], string> = {
    recorded: 'bg-emerald-50 text-emerald-700',
    waived: 'bg-amber-50 text-amber-700',
    reversal: 'bg-red-50 text-red-600',
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      {/* ── plan pricing ─────────────────────────────────────────── */}
      <h2 className="mt-6 font-semibold text-gray-700">{t('pricing.title')}</h2>
      <p className="text-xs text-gray-400">{t('pricing.hint')}</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {plans.map((p) => (
          <li key={p.key} className="rounded-xl border border-gray-200 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>
                <b>{p.name}</b> <span className="text-xs text-gray-400">({p.roleKey})</span>
              </span>
              {priceEdit !== p.key && (
                <button
                  className="text-xs text-brand-600"
                  onClick={() => {
                    setPriceEdit(p.key);
                    setPriceForm({
                      amount: p.priceAmount != null ? String(p.priceAmount) : '',
                      currency: p.currency ?? 'GBP',
                      interval: p.interval ?? 'month',
                    });
                  }}
                >
                  {t('pricing.edit')}
                </button>
              )}
            </div>
            {priceEdit === p.key ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  className="w-24 rounded-lg border border-gray-300 px-2 py-1.5"
                  placeholder={t('pricing.amount')}
                  value={priceForm.amount}
                  onChange={(e) => setPriceForm((f) => ({ ...f, amount: e.target.value }))}
                />
                <select
                  className="rounded-lg border border-gray-300 px-2 py-1.5"
                  value={priceForm.currency}
                  onChange={(e) => setPriceForm((f) => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  className="rounded-lg border border-gray-300 px-2 py-1.5"
                  value={priceForm.interval}
                  onChange={(e) => setPriceForm((f) => ({ ...f, interval: e.target.value }))}
                >
                  <option value="month">{t('pricing.intervals.month')}</option>
                  <option value="year">{t('pricing.intervals.year')}</option>
                </select>
                <button
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  disabled={!priceForm.amount}
                  onClick={() => void savePrice(p.key, false)}
                >
                  {t('pricing.save')}
                </button>
                {p.priced && (
                  <button className="text-xs text-red-500" onClick={() => void savePrice(p.key, true)}>
                    {t('pricing.clear')}
                  </button>
                )}
                <button className="text-xs text-gray-400" onClick={() => setPriceEdit(null)}>
                  {t('pricing.cancel')}
                </button>
              </div>
            ) : p.priced ? (
              <p className="mt-1 font-semibold text-brand-600">
                {money(p.priceAmount as number, p.currency as string)}
                <span className="font-normal text-gray-400"> / {t(`pricing.intervals.${p.interval}`)}</span>
              </p>
            ) : (
              // "Not priced" is a state, not an error — §13.3 leaves tiers TBD,
              // and this page must not pressure anyone into inventing a number.
              <p className="mt-1 text-gray-400">{t('pricing.notPriced')}</p>
            )}
          </li>
        ))}
      </ul>

      {/* ── grant ────────────────────────────────────────────────── */}
      <h2 className="mt-8 font-semibold text-gray-700">{t('grantTitle')}</h2>
      <div className="mt-2 rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder={t('identifier')}
            value={form.identifier}
            onChange={(e) => setForm((f) => ({ ...f, identifier: e.target.value }))}
          />
          <select
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={form.planKey}
            onChange={(e) => setForm((f) => ({ ...f, planKey: e.target.value }))}
          >
            {plans.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.roleKey})
              </option>
            ))}
          </select>
          <input
            type="number"
            className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder={t('months')}
            value={form.months}
            onChange={(e) => setForm((f) => ({ ...f, months: e.target.value }))}
          />
          <button
            onClick={grant}
            disabled={!form.identifier || !form.planKey}
            className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('grant')}
          </button>
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pay.on}
            onChange={(e) =>
              setPay((p) => ({
                ...p,
                on: e.target.checked,
                // Pre-filled with the list price, editable — a discount is a
                // smaller amount, not a lie about the plan.
                amount:
                  e.target.checked && selectedPlan?.priceAmount != null
                    ? String(selectedPlan.priceAmount)
                    : p.amount,
              }))
            }
          />
          {t('payment.toggle')}
        </label>
        {pay.on ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="number"
              min={0}
              className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder={t('payment.amount')}
              value={pay.amount}
              onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))}
            />
            <span className="self-center text-xs text-gray-400">
              {selectedPlan?.currency ?? 'GBP'}
            </span>
            <input
              className="min-w-40 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder={t('payment.reference')}
              value={pay.reference}
              onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))}
            />
            <input
              className="min-w-40 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder={t('payment.note')}
              value={pay.note}
              onChange={(e) => setPay((p) => ({ ...p, note: e.target.value }))}
            />
          </div>
        ) : (
          <p className="mt-1 text-xs text-gray-400">{t('payment.waivedHint')}</p>
        )}
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-600">{msg}</p>}
      {error && <p className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* ── subscriptions ────────────────────────────────────────── */}
      <h2 className="mt-8 font-semibold text-gray-700">{t('listTitle')}</h2>
      <ul className="mt-2 space-y-2">
        {subs.map((s) => (
          <li key={s.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-3 text-sm">
            <span>
              <b>{s.plan.name}</b> · {s.status} · {new Date(s.startsAt).toLocaleDateString()}
              {s.endsAt && ` → ${new Date(s.endsAt).toLocaleDateString()}`}
              <span className="ms-2 text-xs text-gray-400">{s.userId}</span>
            </span>
            {s.status === 'active' && (
              <button className="text-xs text-red-500" onClick={() => revoke(s.id)}>
                {t('revoke')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* ── the money record ─────────────────────────────────────── */}
      <h2 className="mt-8 font-semibold text-gray-700">{t('ledger.title')}</h2>
      <p className="text-xs text-gray-400">{t('ledger.hint')}</p>
      {ledger && ledger.totals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {ledger.totals.map((x) => (
            <div key={x.currency} className="rounded-xl border border-gray-200 px-4 py-2 text-sm">
              <span className="font-semibold text-brand-600">{money(x.collected, x.currency)}</span>{' '}
              <span className="text-gray-400">{t('ledger.collected')}</span>
              {x.foregone > 0 && (
                <span className="ms-3 text-gray-400">
                  {money(x.foregone, x.currency)} {t('ledger.foregone')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {ledger && ledger.entries.length === 0 && (
        <p className="mt-2 text-sm text-gray-400">{t('ledger.empty')}</p>
      )}
      <ul className="mt-2 space-y-2">
        {(ledger?.entries ?? []).map((e) => (
          <li key={e.id} className="rounded-xl border border-gray-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className={`me-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCls[e.status]}`}>
                  {t(`ledger.status.${e.status}`)}
                </span>
                <b>{money(e.amount, e.currency)}</b>
                {e.status === 'waived' && e.listAmount > 0 && (
                  <span className="text-gray-400"> ({t('ledger.worth', { amount: money(e.listAmount, e.currency) })})</span>
                )}
                <span className="ms-2 text-xs text-gray-400">
                  {e.planKey} · {e.user.email ?? e.user.phone ?? e.user.id} ·{' '}
                  {new Date(e.occurredAt).toLocaleDateString()}
                </span>
              </span>
              {e.status === 'recorded' && (
                <button className="text-xs text-red-500" onClick={() => void reverse(e.id)}>
                  {t('ledger.reverse')}
                </button>
              )}
            </div>
            {(e.providerRef || e.note) && (
              <p className="mt-1 text-xs text-gray-400">
                {[e.providerRef, e.note].filter(Boolean).join(' · ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
