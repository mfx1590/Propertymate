'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '../../../i18n/routing';
import { EmptyState } from '../../../components/EmptyState';
import { Money } from '../../../components/Money';
import { CurrencySwitcher } from '../../../components/CurrencySwitcher';
import { useCompare } from '../../../lib/compare';
import { API_BASE, type Property } from '../../../lib/listings';

/** A row of the comparison table; `best` marks which value wins, if any. */
type RowKind = 'text' | 'money' | 'number' | 'area' | 'bool';
interface Row {
  key: string;
  kind: RowKind;
  /** Higher is better for area; lower is better for price. Null = no winner. */
  prefer?: 'high' | 'low';
  value: (p: Property) => string | number | boolean | null;
}

const ROWS: Row[] = [
  { key: 'price', kind: 'money', prefer: 'low', value: (p) => Number(p.priceBaseGbp) },
  {
    key: 'pricePerM2',
    kind: 'money',
    prefer: 'low',
    value: (p) => (p.areaM2 ? Math.round(Number(p.priceBaseGbp) / p.areaM2) : null),
  },
  { key: 'bedrooms', kind: 'number', prefer: 'high', value: (p) => p.bedrooms },
  { key: 'bathrooms', kind: 'number', prefer: 'high', value: (p) => p.bathrooms },
  { key: 'areaM2', kind: 'area', prefer: 'high', value: (p) => p.areaM2 },
  { key: 'plotM2', kind: 'area', prefer: 'high', value: (p) => p.plotM2 ?? null },
  { key: 'deedType', kind: 'text', value: (p) => p.deedType },
  { key: 'furnished', kind: 'bool', value: (p) => p.furnished },
  { key: 'region', kind: 'text', value: () => '' },
];

export default function ComparePage() {
  const t = useTranslations('compare');
  const tf = useTranslations('search');
  const locale = useLocale();
  const { ids, remove, clear } = useCompare();
  const [items, setItems] = useState<Property[] | null>(null);

  const load = useCallback(async () => {
    if (ids.length === 0) {
      setItems([]);
      return;
    }
    const loaded = await Promise.all(
      ids.map((id) =>
        fetch(`${API_BASE}/properties/${id}`, { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    );
    // A listing can be removed or sold between adding and comparing; drop it
    // rather than rendering an empty column with no explanation.
    setItems(loaded.filter((x): x is Property => Boolean(x)));
  }, [ids]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!items) return <main className="mx-auto max-w-6xl p-6 text-gray-400">…</main>;

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <EmptyState
          icon="⚖️"
          title={t('emptyState.title')}
          body={t('emptyState.body')}
          action={{ label: t('emptyState.action'), href: '/search' }}
        />
      </main>
    );
  }

  const title = (p: Property) =>
    (p.titleI18n as Record<string, string>)?.[locale] ||
    (p.titleI18n as Record<string, string>)?.en ||
    '';

  /** Which column wins a row — only meaningful when the values differ. */
  const winners = (row: Row): Set<number> => {
    if (!row.prefer) return new Set();
    const nums = items.map((p) => {
      const v = row.value(p);
      return typeof v === 'number' ? v : null;
    });
    const present = nums.filter((n): n is number => n !== null);
    if (present.length < 2) return new Set();
    const best = row.prefer === 'low' ? Math.min(...present) : Math.max(...present);
    // Everything equal means nothing to highlight — a table of green ticks
    // tells the reader nothing.
    if (present.every((n) => n === best)) return new Set();
    return new Set(nums.flatMap((n, i) => (n === best ? [i] : [])));
  };

  const render = (row: Row, p: Property) => {
    if (row.key === 'region') {
      const n = p.region?.nameI18n as Record<string, string> | undefined;
      return n?.[locale] || n?.en || p.region?.slug || '—';
    }
    const v = row.value(p);
    if (v === null || v === undefined || v === '') return <span className="text-gray-300">—</span>;
    if (row.kind === 'money') return <Money gbp={Number(v)} />;
    // A bare "100" in an area row is ambiguous; the unit belongs with it.
    if (row.kind === 'area') return `${v} m²`;
    if (row.kind === 'bool') return v ? t('yes') : t('no');
    if (row.key === 'deedType') return tf(`deed.${v}`);
    return String(v);
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="flex items-center gap-3">
          <CurrencySwitcher />
          <button onClick={clear} className="text-sm text-gray-500 hover:text-brand-600">
            {t('clearAll')}
          </button>
        </div>
      </div>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-32 p-2" />
              {items.map((p) => (
                <th key={p.id} className="p-2 text-left align-top">
                  <Link href={`/listing/${p.id}`} className="block">
                    {p.media?.[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.media[0].url}
                        alt=""
                        className="h-24 w-full rounded-lg object-cover"
                      />
                    ) : (
                      <div className="h-24 w-full rounded-lg bg-gray-100" />
                    )}
                    <span className="mt-2 block font-semibold hover:text-brand-600">
                      {title(p)}
                    </span>
                  </Link>
                  <button
                    onClick={() => remove(p.id)}
                    className="mt-1 text-xs text-gray-400 hover:text-red-600"
                  >
                    {t('remove')}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const win = winners(row);
              return (
                <tr key={row.key} className="border-t border-gray-100">
                  <th scope="row" className="p-2 text-left font-medium text-gray-500">
                    {t(`rows.${row.key}`)}
                  </th>
                  {items.map((p, i) => (
                    <td
                      key={p.id}
                      className={`p-2 ${win.has(i) ? 'font-semibold text-emerald-700' : ''}`}
                    >
                      {render(row, p)}
                      {win.has(i) && <span className="sr-only"> — {t('best')}</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
