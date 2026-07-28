'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ApiError, apiDelete, apiGet, apiPost, apiPut, apiUpload } from '../../../../../lib/api';
import { Link, useRouter } from '../../../../../i18n/routing';
import type { RegionInfo } from '../../../../../lib/listings';
import {
  pickI18n,
  type MyProject,
  type PaymentPlan,
  type ProjectMedia,
  type ProjectRequirement,
} from '../../../../../lib/projects';

const MapPicker = dynamic(() => import('../../../../../components/MapPicker'), { ssr: false });

interface UploadedDoc {
  id: string;
  documentType: string;
  status: string;
  uploadedAt: string;
}

const emptyPlan = (): PaymentPlan => ({
  name: '',
  downPaymentPct: 30,
  installments: 12,
  installmentFrequency: 'monthly',
  onDeliveryPct: 0,
});

function EditorInner() {
  const t = useTranslations('projects');
  const locale = useLocale();
  const router = useRouter();
  const projectId = useSearchParams().get('id');

  const [project, setProject] = useState<MyProject | null>(null);
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [photos, setPhotos] = useState<ProjectMedia[]>([]);
  const [requirements, setRequirements] = useState<ProjectRequirement[]>([]);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    description: '',
    regionSlug: 'kyrenia',
    lat: null as number | null,
    lng: null as number | null,
    deliveryDate: '',
    paymentPlans: [] as PaymentPlan[],
  });
  const set = (k: string, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

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

  const loadDocuments = useCallback(
    (id: string) => apiGet<UploadedDoc[]>(`/projects/${id}/documents`).then(setDocuments),
    [],
  );

  useEffect(() => {
    void apiGet<RegionInfo[]>('/regions').then(setRegions);
    void apiGet<ProjectRequirement[]>('/projects/requirements').then(setRequirements);
  }, []);

  // `/projects/:id` only serves live projects, so a draft is read off the board.
  useEffect(() => {
    if (!projectId) return;
    void apiGet<MyProject[]>('/projects/mine').then((all) => {
      const p = all.find((x) => x.id === projectId);
      if (!p) return;
      setProject(p);
      setPhotos(p.media ?? []);
      setForm({
        name: pickI18n(p.nameI18n, 'en'),
        description: pickI18n(p.descriptionI18n, 'en'),
        regionSlug: p.region?.slug ?? 'kyrenia',
        lat: p.lat,
        lng: p.lng,
        deliveryDate: p.deliveryDate ? p.deliveryDate.slice(0, 10) : '',
        paymentPlans: p.paymentPlans ?? [],
      });
    });
    void loadDocuments(projectId);
  }, [projectId, loadDocuments]);

  const save = async () => {
    if (!projectId) return;
    const payload: Record<string, unknown> = {
      name: form.name || undefined,
      description: form.description || undefined,
      regionSlug: form.regionSlug,
      lat: form.lat ?? undefined,
      lng: form.lng ?? undefined,
      deliveryDate: form.deliveryDate ? new Date(form.deliveryDate).toISOString() : undefined,
      paymentPlans: form.paymentPlans.filter((p) => p.name.trim().length > 0),
    };
    await apiPut(`/projects/${projectId}`, payload);
    setSaved(true);
  };

  const uploadPhotos = (files: FileList) =>
    run(async () => {
      if (!projectId) return;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const m = await apiUpload<ProjectMedia>(`/projects/${projectId}/photos`, fd);
        setPhotos((prev) => [...prev, m]);
      }
    });

  const removePhoto = (mediaId: string) =>
    run(async () => {
      if (!projectId) return;
      await apiDelete(`/projects/${projectId}/photos/${mediaId}`);
      setPhotos((prev) => prev.filter((m) => m.id !== mediaId));
    });

  const uploadDocument = (documentType: string, file: File) =>
    run(async () => {
      if (!projectId) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', documentType);
      await apiUpload(`/projects/${projectId}/documents`, fd);
      await loadDocuments(projectId);
    });

  const submit = () =>
    run(async () => {
      if (!projectId) return;
      await save();
      await apiPost(`/projects/${projectId}/submit`);
      router.push('/dashboard/projects');
    });

  const regionCenter = useMemo(() => {
    const r = regions.find((x) => x.slug === form.regionSlug);
    return { lat: r?.lat ?? 35.2, lng: r?.lng ?? 33.4 };
  }, [regions, form.regionSlug]);

  const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5';
  const isDraft = !project || project.status === 'draft';

  if (!projectId) {
    return (
      <div className="max-w-xl">
        <p className="text-gray-500">{t('board.empty')}</p>
        <Link href="/dashboard/projects" className="mt-4 inline-block font-medium text-brand-600">
          ← {t('board.title')}
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/projects" className="text-sm text-gray-500">
        ← {t('board.title')}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{t('editor.title')}</h1>

      {project && project.status === 'pending_verification' && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('editor.pendingNotice')}
        </p>
      )}
      {project && project.status === 'live' && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {t('editor.liveNotice')}
        </p>
      )}

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">{t('editor.name')}</span>
          <input
            className={inputCls}
            value={form.name}
            placeholder={t('editor.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">{t('editor.description')}</span>
          <textarea
            className={inputCls}
            rows={5}
            value={form.description}
            placeholder={t('editor.descriptionPlaceholder')}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">{t('editor.region')}</span>
            <select
              className={inputCls}
              value={form.regionSlug}
              onChange={(e) => set('regionSlug', e.target.value)}
            >
              {regions.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {pickI18n(r.nameI18n, locale) || r.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">{t('editor.deliveryDate')}</span>
            <input
              className={inputCls}
              type="date"
              value={form.deliveryDate}
              onChange={(e) => set('deliveryDate', e.target.value)}
            />
          </label>
        </div>

        {/* location */}
        <div>
          <span className="text-sm font-medium text-gray-700">{t('editor.location')}</span>
          <p className="text-xs text-gray-400">{t('editor.mapHint')}</p>
          <div className="mt-2">
            <MapPicker
              lat={form.lat}
              lng={form.lng}
              center={regionCenter}
              onChange={(lat: number, lng: number) => {
                setForm((f) => ({ ...f, lat, lng }));
                setSaved(false);
              }}
            />
          </div>
        </div>

        {/* payment plans */}
        <div className="rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">{t('editor.paymentPlans')}</span>
            <button
              type="button"
              className="text-sm font-medium text-brand-600"
              onClick={() => set('paymentPlans', [...form.paymentPlans, emptyPlan()])}
            >
              + {t('editor.addPlan')}
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-400">{t('editor.paymentPlansHint')}</p>

          {form.paymentPlans.map((plan, i) => (
            <div key={i} className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-5">
              <label className="col-span-2 block sm:col-span-1">
                <span className="text-xs text-gray-500">{t('editor.planName')}</span>
                <input
                  className={inputCls}
                  value={plan.name}
                  onChange={(e) =>
                    set(
                      'paymentPlans',
                      form.paymentPlans.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                    )
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">{t('editor.downPayment')}</span>
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={100}
                  value={plan.downPaymentPct}
                  onChange={(e) =>
                    set(
                      'paymentPlans',
                      form.paymentPlans.map((p, j) =>
                        j === i ? { ...p, downPaymentPct: Number(e.target.value) } : p,
                      ),
                    )
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">{t('editor.installments')}</span>
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={240}
                  value={plan.installments}
                  onChange={(e) =>
                    set(
                      'paymentPlans',
                      form.paymentPlans.map((p, j) =>
                        j === i ? { ...p, installments: Number(e.target.value) } : p,
                      ),
                    )
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">{t('editor.frequency')}</span>
                <select
                  className={inputCls}
                  value={plan.installmentFrequency ?? 'monthly'}
                  onChange={(e) =>
                    set(
                      'paymentPlans',
                      form.paymentPlans.map((p, j) =>
                        j === i
                          ? { ...p, installmentFrequency: e.target.value as 'monthly' | 'quarterly' }
                          : p,
                      ),
                    )
                  }
                >
                  <option value="monthly">{t('editor.monthly')}</option>
                  <option value="quarterly">{t('editor.quarterly')}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">{t('editor.onDelivery')}</span>
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={100}
                  value={plan.onDeliveryPct ?? 0}
                  onChange={(e) =>
                    set(
                      'paymentPlans',
                      form.paymentPlans.map((p, j) =>
                        j === i ? { ...p, onDeliveryPct: Number(e.target.value) } : p,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="col-span-2 text-start text-xs text-red-600 sm:col-span-5"
                onClick={() =>
                  set(
                    'paymentPlans',
                    form.paymentPlans.filter((_, j) => j !== i),
                  )
                }
              >
                {t('editor.remove')}
              </button>
            </div>
          ))}
        </div>

        {/* photos */}
        <div className="rounded-xl border border-gray-200 p-4">
          <span className="text-sm font-medium text-gray-700">{t('editor.photos')}</span>
          <p className="mt-1 text-xs text-gray-400">{t('editor.photosHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {photos.map((m, i) => (
              <div key={m.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" className="h-20 w-28 rounded-lg object-cover" />
                {i === 0 && (
                  <span className="absolute start-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white">
                    {t('editor.cover')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePhoto(m.id)}
                  className="absolute end-1 top-1 rounded bg-black/60 px-1.5 text-[10px] text-white"
                >
                  ×
                </button>
              </div>
            ))}
            <label className="flex h-20 w-28 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-xs text-gray-500">
              + {t('editor.dropPhotos')}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadPhotos(e.target.files)}
              />
            </label>
          </div>
        </div>

        {/* documents */}
        <div className="rounded-xl border border-gray-200 p-4">
          <span className="text-sm font-medium text-gray-700">{t('editor.documents')}</span>
          <p className="mt-1 text-xs text-gray-400">{t('editor.documentsHint')}</p>
          <ul className="mt-3 space-y-2">
            {requirements.map((req) => {
              const uploaded = documents.filter((d) => d.documentType === req.documentType);
              return (
                <li
                  key={req.documentType}
                  className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {pickI18n(req.titleI18n, locale) || req.documentType}
                      <span className="ms-2 text-xs font-normal text-gray-400">
                        {req.isRequired ? t('editor.required') : t('editor.optional')}
                      </span>
                    </p>
                    {req.helpI18n && (
                      <p className="truncate text-xs text-gray-400">{pickI18n(req.helpI18n, locale)}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {uploaded.length > 0 && (
                      <span className="text-xs text-emerald-600">
                        ✓ {t('editor.uploaded')} ({uploaded.length})
                      </span>
                    )}
                    <label className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium">
                      {t('editor.upload')}
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) =>
                          e.target.files?.[0] && uploadDocument(req.documentType, e.target.files[0])
                        }
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={() => run(save)}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('editor.saving') : saved ? t('editor.saved') : t('editor.save')}
        </button>
        <Link
          href={`/dashboard/projects/${projectId}`}
          className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium"
        >
          {t('board.manageUnits')}
        </Link>
        {isDraft && (
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? t('editor.submitting') : t('editor.submit')}
          </button>
        )}
        {isDraft && <span className="text-xs text-gray-400">{t('editor.submitHint')}</span>}
      </div>
    </div>
  );
}

export default function ProjectEditorPage() {
  return (
    <Suspense fallback={<p className="text-gray-400">…</p>}>
      <EditorInner />
    </Suspense>
  );
}
