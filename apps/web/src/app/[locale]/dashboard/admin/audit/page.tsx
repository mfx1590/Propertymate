'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiGet } from '../../../../../lib/api';
import { downloadAuthenticated } from '../../../../../lib/download';

interface AuditRow {
  id: string;
  actorId: string | null;
  actor: { id: string; phone: string | null; email: string | null } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

const EMPTY = { actorId: '', entityType: '', entityId: '', action: '', from: '', to: '' };

/**
 * The audit-log browser (§6.7) — the first reader the audit table has had.
 *
 * Filters are the same ones the export honours, so "download what I am
 * looking at" is one button rather than a second form.
 */
export default function AuditBrowserPage() {
  const t = useTranslations('adminAudit');
  const locale = useLocale();
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [actions, setActions] = useState<string[]>([]);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (f: typeof EMPTY, after?: string) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) {
        if (!v) continue;
        // Date inputs are local calendar days; send whole-day bounds in ISO.
        if (k === 'from') qs.set(k, new Date(`${v}T00:00:00`).toISOString());
        else if (k === 'to') qs.set(k, new Date(`${v}T23:59:59.999`).toISOString());
        else qs.set(k, v);
      }
      if (after) qs.set('cursor', after);
      qs.set('limit', '50');
      return qs.toString();
    },
    [],
  );

  const load = useCallback(
    async (f: typeof EMPTY, after?: string) => {
      setBusy(true);
      setError(null);
      try {
        const page = await apiGet<{ rows: AuditRow[]; nextCursor: string | null }>(`/admin/audit?${query(f, after)}`);
        setRows((prev) => (after ? [...prev, ...page.rows] : page.rows));
        setCursor(page.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void load(EMPTY);
    apiGet<string[]>('/admin/audit/actions').then(setActions).catch(() => setActions([]));
  }, [load]);

  const apply = () => {
    setApplied(filters);
    void load(filters);
  };
  const reset = () => {
    setFilters(EMPTY);
    setApplied(EMPTY);
    void load(EMPTY);
  };

  const inputCls = 'rounded-lg border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-gray-500">{t('subtitle')}</p>

      <div className="mt-4 flex flex-wrap gap-2 rounded-xl border border-gray-200 p-4">
        <select className={inputCls} value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}>
          <option value="">{t('anyAction')}</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <input className={`${inputCls} w-36`} placeholder={t('entityType')} value={filters.entityType} onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))} />
        <input className={`${inputCls} w-56`} placeholder={t('entityId')} value={filters.entityId} onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))} />
        <input className={`${inputCls} w-56`} placeholder={t('actorId')} value={filters.actorId} onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value }))} />
        <input type="date" className={inputCls} value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        <input type="date" className={inputCls} value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        <button onClick={apply} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {t('apply')}
        </button>
        <button onClick={reset} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600">
          {t('reset')}
        </button>
        <button
          onClick={() => void downloadAuthenticated(`/admin/exports/audit?${query(applied)}`, 'propverify-audit.csv').catch((e) => setError(String(e.message ?? e)))}
          className="ms-auto rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-600"
        >
          {t('exportThis')}
        </button>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-3 py-2">{t('col.when')}</th>
              <th className="px-3 py-2">{t('col.actor')}</th>
              <th className="px-3 py-2">{t('col.action')}</th>
              <th className="px-3 py-2">{t('col.entity')}</th>
              <th className="px-3 py-2">{t('col.ip')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <>
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-500">{new Date(r.createdAt).toLocaleString(locale)}</td>
                  <td className="px-3 py-2">{r.actor?.email ?? r.actor?.phone ?? (r.actorId ? r.actorId.slice(0, 8) + '…' : t('system'))}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {r.entityType}
                    {r.entityId && <span className="text-gray-400"> · {r.entityId}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-400">{r.ip ?? ''}</td>
                  <td className="px-3 py-2 text-right">
                    {(r.before != null || r.after != null) && (
                      <button className="text-xs text-brand-600" onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {open === r.id ? t('hide') : t('details')}
                      </button>
                    )}
                  </td>
                </tr>
                {open === r.id && (
                  <tr key={`${r.id}-d`} className="border-b border-gray-100 bg-gray-50">
                    <td colSpan={6} className="px-3 py-2">
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-gray-600">
                        {JSON.stringify({ before: r.before ?? null, after: r.after ?? null }, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !busy && <p className="p-4 text-sm text-gray-400">{t('empty')}</p>}
      </div>

      {cursor && (
        <button
          disabled={busy}
          onClick={() => void load(applied, cursor)}
          className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-50"
        >
          {busy ? '…' : t('more')}
        </button>
      )}
    </div>
  );
}
