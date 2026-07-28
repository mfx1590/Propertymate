'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../../../../lib/api';
import { Link } from '../../../../../i18n/routing';
import { fmtMoney } from '../../../../../lib/listings';
import {
  UNIT_STATUS_STYLES,
  pickI18n,
  type ImportReport,
  type MyProject,
  type ProjectLeads,
  type ProjectUnit,
  type ProjectUpdateItem,
} from '../../../../../lib/projects';

const CURRENCIES = ['GBP', 'EUR', 'USD', 'TRY'];
const TABS = ['units', 'updates', 'leads'] as const;
type Tab = (typeof TABS)[number];

/** Blank row used by both "add unit" and the inline editor. */
const emptyDraft = () => ({
  unitNo: '',
  type: '',
  bedrooms: '',
  areaM2: '',
  floor: '',
  priceAmount: '',
  priceCurrency: 'GBP',
});
type UnitDraft = ReturnType<typeof emptyDraft>;

const toPayload = (d: UnitDraft) => ({
  unitNo: d.unitNo,
  type: d.type || undefined,
  bedrooms: d.bedrooms === '' ? undefined : Number(d.bedrooms),
  areaM2: d.areaM2 === '' ? undefined : Number(d.areaM2),
  floor: d.floor === '' ? undefined : Number(d.floor),
  priceAmount: Number(d.priceAmount),
  priceCurrency: d.priceCurrency,
});

export default function ManageProjectPage() {
  const t = useTranslations('projects');
  const locale = useLocale();
  const projectId = useParams().id as string;

  const [tab, setTab] = useState<Tab>('units');
  const [project, setProject] = useState<MyProject | null>(null);
  const [units, setUnits] = useState<ProjectUnit[] | null>(null);
  const [updates, setUpdates] = useState<ProjectUpdateItem[]>([]);
  const [leads, setLeads] = useState<ProjectLeads | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<UnitDraft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<UnitDraft>(emptyDraft());
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [post, setPost] = useState({ title: '', body: '' });
  const [notified, setNotified] = useState<number | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const loadUnits = useCallback(
    () => apiGet<ProjectUnit[]>(`/projects/${projectId}/units`).then(setUnits),
    [projectId],
  );

  useEffect(() => {
    void apiGet<MyProject[]>('/projects/mine').then((all) =>
      setProject(all.find((x) => x.id === projectId) ?? null),
    );
    void loadUnits();
  }, [projectId, loadUnits]);

  useEffect(() => {
    if (tab === 'updates') void apiGet<ProjectUpdateItem[]>(`/projects/${projectId}/updates`).then(setUpdates);
    if (tab === 'leads') void apiGet<ProjectLeads>(`/projects/${projectId}/leads`).then(setLeads);
  }, [tab, projectId]);

  const addUnit = () =>
    run(async () => {
      await apiPost(`/projects/${projectId}/units`, toPayload(draft));
      setDraft(emptyDraft());
      await loadUnits();
    });

  const saveEdit = (unitId: string) =>
    run(async () => {
      const { unitNo: _unitNo, ...rest } = toPayload(editDraft);
      await apiPut(`/projects/${projectId}/units/${unitId}`, rest);
      setEditingId(null);
      await loadUnits();
    });

  const setUnitStatus = (unitId: string, status: 'available' | 'reserved') =>
    run(async () => {
      await apiPut(`/projects/${projectId}/units/${unitId}`, { status });
      await loadUnits();
    });

  const removeUnit = (unitId: string) =>
    run(async () => {
      if (!window.confirm(t('units.confirmRemove'))) return;
      await apiDelete(`/projects/${projectId}/units/${unitId}`);
      await loadUnits();
    });

  const runImport = () =>
    run(async () => {
      const res = await apiPost<ImportReport>(`/projects/${projectId}/units/import`, { csv });
      setReport(res);
      setCsv('');
      await loadUnits();
    });

  const publishUpdate = () =>
    run(async () => {
      const res = await apiPost<{ id: string; notified: number }>(`/projects/${projectId}/updates`, post);
      setNotified(res.notified);
      setPost({ title: '', body: '' });
      setUpdates(await apiGet<ProjectUpdateItem[]>(`/projects/${projectId}/updates`));
    });

  const inputCls = 'w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm';

  const draftFields = (d: UnitDraft, setD: (u: UnitDraft) => void, withUnitNo: boolean) => (
    <>
      {withUnitNo && (
        <td className="p-1">
          <input className={inputCls} value={d.unitNo} onChange={(e) => setD({ ...d, unitNo: e.target.value })} />
        </td>
      )}
      <td className="p-1">
        <input className={inputCls} value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })} />
      </td>
      <td className="p-1">
        <input
          className={inputCls}
          type="number"
          value={d.bedrooms}
          onChange={(e) => setD({ ...d, bedrooms: e.target.value })}
        />
      </td>
      <td className="p-1">
        <input
          className={inputCls}
          type="number"
          value={d.areaM2}
          onChange={(e) => setD({ ...d, areaM2: e.target.value })}
        />
      </td>
      <td className="p-1">
        <input
          className={inputCls}
          type="number"
          value={d.floor}
          onChange={(e) => setD({ ...d, floor: e.target.value })}
        />
      </td>
      <td className="p-1">
        <input
          className={inputCls}
          type="number"
          value={d.priceAmount}
          onChange={(e) => setD({ ...d, priceAmount: e.target.value })}
        />
      </td>
      <td className="p-1">
        <select
          className={inputCls}
          value={d.priceCurrency}
          onChange={(e) => setD({ ...d, priceCurrency: e.target.value })}
        >
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </td>
    </>
  );

  return (
    <div className="max-w-5xl">
      <Link href="/dashboard/projects" className="text-sm text-gray-500">
        ← {t('board.title')}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">
        {project ? pickI18n(project.nameI18n, locale) || t('board.untitled') : '…'}
      </h1>

      <div className="mt-4 flex gap-2 border-b border-gray-200">
        {TABS.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === s ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500'
            }`}
          >
            {s === 'units' ? t('units.title') : s === 'updates' ? t('updates.title') : t('leads.title')}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {/* ── units ─────────────────────────────────────────────────── */}
      {tab === 'units' && (
        <div className="mt-6">
          <p className="text-sm text-gray-500">{t('units.subtitle')}</p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-start text-xs text-gray-400">
                  <th className="p-1 text-start font-medium">{t('units.unitNo')}</th>
                  <th className="p-1 text-start font-medium">{t('units.type')}</th>
                  <th className="p-1 text-start font-medium">{t('units.bedrooms')}</th>
                  <th className="p-1 text-start font-medium">{t('units.areaM2')}</th>
                  <th className="p-1 text-start font-medium">{t('units.floor')}</th>
                  <th className="p-1 text-start font-medium">{t('units.price')}</th>
                  <th className="p-1 text-start font-medium">{t('units.currency')}</th>
                  <th className="p-1 text-start font-medium">{t('units.status')}</th>
                  <th className="p-1 text-start font-medium">{t('units.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {units?.map((u) =>
                  editingId === u.id ? (
                    <tr key={u.id} className="border-t border-gray-100 bg-brand-50/40">
                      <td className="p-1 font-medium">{u.unitNo}</td>
                      {draftFields(editDraft, setEditDraft, false)}
                      <td className="p-1 text-xs text-gray-400">{t(`unitStatus.${u.status}`)}</td>
                      <td className="whitespace-nowrap p-1">
                        <button
                          className="font-medium text-brand-600 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => saveEdit(u.id)}
                        >
                          {t('units.save')}
                        </button>
                        <button className="ms-3 text-gray-500" onClick={() => setEditingId(null)}>
                          {t('units.cancel')}
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={u.id} className="border-t border-gray-100">
                      <td className="p-1 font-medium">{u.unitNo}</td>
                      <td className="p-1">{u.type ?? '—'}</td>
                      <td className="p-1">{u.bedrooms ?? '—'}</td>
                      <td className="p-1">{u.areaM2 ?? '—'}</td>
                      <td className="p-1">{u.floor ?? '—'}</td>
                      <td className="p-1">{fmtMoney(Number(u.priceAmount), u.priceCurrency)}</td>
                      <td className="p-1 text-gray-400">{u.priceCurrency}</td>
                      <td className="p-1">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${UNIT_STATUS_STYLES[u.status]}`}
                        >
                          {t(`unitStatus.${u.status}`)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap p-1">
                        {u.status !== 'sold' && (
                          <>
                            <button
                              className="text-brand-600"
                              onClick={() => {
                                setEditingId(u.id);
                                setEditDraft({
                                  unitNo: u.unitNo,
                                  type: u.type ?? '',
                                  bedrooms: u.bedrooms?.toString() ?? '',
                                  areaM2: u.areaM2?.toString() ?? '',
                                  floor: u.floor?.toString() ?? '',
                                  priceAmount: u.priceAmount,
                                  priceCurrency: u.priceCurrency,
                                });
                              }}
                            >
                              {t('units.edit')}
                            </button>
                            <button
                              className="ms-3 text-gray-500 disabled:opacity-50"
                              disabled={busy}
                              onClick={() =>
                                setUnitStatus(u.id, u.status === 'available' ? 'reserved' : 'available')
                              }
                            >
                              {u.status === 'available' ? t('units.hold') : t('units.release')}
                            </button>
                            <button
                              className="ms-3 text-red-600 disabled:opacity-50"
                              disabled={busy}
                              onClick={() => removeUnit(u.id)}
                            >
                              {t('units.remove')}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ),
                )}

                {/* add row */}
                <tr className="border-t-2 border-gray-200">
                  {draftFields(draft, setDraft, true)}
                  <td />
                  <td className="p-1">
                    <button
                      className="whitespace-nowrap font-medium text-brand-600 disabled:opacity-50"
                      disabled={busy || !draft.unitNo || !draft.priceAmount}
                      onClick={addUnit}
                    >
                      + {t('units.add')}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {units?.length === 0 && <p className="mt-4 text-sm text-gray-500">{t('units.empty')}</p>}

          {/* bulk import */}
          <div className="mt-8 rounded-xl border border-gray-200 p-4">
            <span className="text-sm font-medium text-gray-700">{t('units.import')}</span>
            <p className="mt-1 text-xs text-gray-400">{t('units.importHint')}</p>
            <textarea
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
              rows={6}
              value={csv}
              placeholder="unit_no,type,bedrooms,area_m2,floor,price,currency"
              onChange={(e) => setCsv(e.target.value)}
            />
            <button
              className="mt-3 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy || !csv.trim()}
              onClick={runImport}
            >
              {busy ? t('units.importing') : t('units.runImport')}
            </button>

            {report && (
              <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
                <p className="font-medium">
                  <span className="text-emerald-700">{t('units.reportCreated', { count: report.created })}</span>
                  {' · '}
                  <span className="text-blue-700">{t('units.reportUpdated', { count: report.updated })}</span>
                  {' · '}
                  <span className="text-amber-700">
                    {t('units.reportSkipped', { count: report.skipped.length })}
                  </span>
                </p>
                {report.skipped.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
                    {report.skipped.map((s) => (
                      <li key={s.line}>
                        {t('units.line', { line: s.line })}: {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── updates ───────────────────────────────────────────────── */}
      {tab === 'updates' && (
        <div className="mt-6 max-w-2xl">
          <div className="rounded-xl border border-gray-200 p-4">
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
              value={post.title}
              placeholder={t('updates.composeTitle')}
              onChange={(e) => setPost({ ...post, title: e.target.value })}
            />
            <textarea
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
              rows={4}
              value={post.body}
              placeholder={t('updates.composeBody')}
              onChange={(e) => setPost({ ...post, body: e.target.value })}
            />
            <button
              className="mt-3 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy || !post.title.trim() || !post.body.trim()}
              onClick={publishUpdate}
            >
              {busy ? t('updates.publishing') : t('updates.publish')}
            </button>
            {notified !== null && (
              <p className="mt-2 text-sm text-emerald-700">{t('updates.notified', { count: notified })}</p>
            )}
          </div>

          {updates.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">{t('updates.empty')}</p>
          ) : (
            <ul className="mt-6 space-y-3">
              {updates.map((u) => (
                <li key={u.id} className="rounded-xl border border-gray-200 p-4">
                  <p className="font-medium">{pickI18n(u.titleI18n, locale)}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-gray-600">
                    {pickI18n(u.bodyI18n, locale)}
                  </p>
                  <p className="mt-2 text-xs text-gray-400">
                    {new Date(u.publishedAt).toLocaleDateString(locale)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── leads ─────────────────────────────────────────────────── */}
      {tab === 'leads' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="font-semibold">{t('leads.inquiries')}</h2>
            {!leads || leads.inquiries.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">{t('leads.noInquiries')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {leads.inquiries.map((i) => (
                  <li key={i.conversationId} className="rounded-xl border border-gray-200 p-3">
                    <p className="text-sm text-gray-700">{i.preview ?? '—'}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {new Date(i.lastMessageAt).toLocaleString(locale)}
                      </span>
                      <Link href="/dashboard/messages" className="text-xs font-medium text-brand-600">
                        {t('leads.open')} →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="font-semibold">{t('leads.reservations')}</h2>
            {!leads || leads.reservations.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">{t('leads.noReservations')}</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {leads.reservations.map((r) => (
                  <li key={r.dealId} className="rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        {t('leads.unit')} {r.unit?.unitNo ?? '—'}
                      </p>
                      {r.priceAgreed && r.currency && (
                        <span className="text-sm">{fmtMoney(Number(r.priceAgreed), r.currency)}</span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        {t('leads.stage')}: {r.currentStageKey ?? r.status}
                      </span>
                      <Link href={`/dashboard/deals/${r.dealId}`} className="text-xs font-medium text-brand-600">
                        {t('leads.open')} →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
