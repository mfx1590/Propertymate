'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from '../../../../../lib/api';
import { useRouter } from '../../../../../i18n/routing';
import {
  FEATURE_KEYS,
  type Property,
  type PropertyMedia,
  type RegionInfo,
} from '../../../../../lib/listings';
import type { RequirementConfig } from '../../../../../lib/types';

const MapPicker = dynamic(() => import('../../../../../components/MapPicker'), { ssr: false });

const STEPS = ['details', 'location', 'features', 'photos', 'documents', 'review'] as const;
type Step = (typeof STEPS)[number];

interface UploadedDoc {
  id: string;
  documentType: string;
  status: string;
  uploadedAt: string;
}

const CURRENCIES = ['GBP', 'EUR', 'USD', 'TRY'];
const DEED_TYPES = ['turkish', 'exchange', 'allocation', 'foreign', 'na'];

function WizardInner() {
  const t = useTranslations('listings');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const resumeId = params.get('id');

  const [property, setProperty] = useState<Property | null>(null);
  const [step, setStep] = useState<Step>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form state (step 1–3)
  const [form, setForm] = useState({
    title: '',
    description: '',
    regionSlug: 'kyrenia',
    district: '',
    lat: null as number | null,
    lng: null as number | null,
    priceAmount: '',
    priceCurrency: 'GBP',
    bedrooms: '',
    bathrooms: '',
    areaM2: '',
    plotM2: '',
    deedType: 'na',
    furnished: false,
    features: [] as string[],
  });
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [photos, setPhotos] = useState<(PropertyMedia & { duplicateWarning?: boolean })[]>([]);
  const [requirements, setRequirements] = useState<RequirementConfig[]>([]);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    void apiGet<RegionInfo[]>('/regions').then(setRegions);
  }, []);

  // resume an existing draft
  useEffect(() => {
    if (!resumeId) return;
    void apiGet<Property>(`/properties/${resumeId}`).then((p) => {
      setProperty(p);
      setPhotos(p.media);
      setForm({
        title: p.titleI18n?.en ?? '',
        description: p.descriptionI18n?.en ?? '',
        regionSlug: p.region.slug,
        district: p.district ?? '',
        lat: p.lat,
        lng: p.lng,
        priceAmount: Number(p.priceAmount) > 0 ? String(Number(p.priceAmount)) : '',
        priceCurrency: p.priceCurrency,
        bedrooms: p.bedrooms?.toString() ?? '',
        bathrooms: p.bathrooms?.toString() ?? '',
        areaM2: p.areaM2?.toString() ?? '',
        plotM2: p.plotM2?.toString() ?? '',
        deedType: p.deedType,
        furnished: p.furnished,
        features: p.features ?? [],
      });
    });
  }, [resumeId]);

  // kind selection creates the draft
  const [kind, setKind] = useState<'resale' | 'rental' | null>(null);
  const effectiveKind = property?.kind ?? kind;

  useEffect(() => {
    if (!effectiveKind) return;
    void apiGet<RequirementConfig[]>(`/properties/requirements?kind=${effectiveKind}`).then(
      setRequirements,
    );
  }, [effectiveKind]);

  const loadDocuments = useCallback(async (id: string) => {
    setDocuments(await apiGet<UploadedDoc[]>(`/properties/${id}/documents`));
  }, []);

  useEffect(() => {
    if (property) void loadDocuments(property.id);
  }, [property, loadDocuments]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const startDraft = (k: 'resale' | 'rental') =>
    run(async () => {
      setKind(k);
      const p = await apiPost<Property>('/properties', { kind: k });
      setProperty({ ...p, media: [], region: { slug: 'kyrenia', nameI18n: {} } });
    });

  /** Persist current form to the draft (autosave on step transitions). */
  const saveDraft = async () => {
    if (!property) return;
    const payload: Record<string, unknown> = {
      title: form.title || undefined,
      description: form.description || undefined,
      regionSlug: form.regionSlug,
      district: form.district || undefined,
      lat: form.lat ?? undefined,
      lng: form.lng ?? undefined,
      priceAmount: form.priceAmount ? Number(form.priceAmount) : undefined,
      priceCurrency: form.priceCurrency,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : undefined,
      bathrooms: form.bathrooms ? Number(form.bathrooms) : undefined,
      areaM2: form.areaM2 ? Number(form.areaM2) : undefined,
      plotM2: form.plotM2 ? Number(form.plotM2) : undefined,
      deedType: form.deedType,
      furnished: form.furnished,
      features: form.features,
    };
    await apiPut(`/properties/${property.id}`, payload);
  };

  const goTo = (target: Step) =>
    run(async () => {
      await saveDraft();
      setStep(target);
    });

  const uploadPhotos = (files: FileList) =>
    run(async () => {
      if (!property) return;
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiUpload<PropertyMedia & { duplicateWarning?: boolean }>(
          `/properties/${property.id}/photos`,
          fd,
        );
        setPhotos((prev) => [...prev, res]);
      }
    });

  const removePhoto = (mediaId: string) =>
    run(async () => {
      if (!property) return;
      await apiDelete(`/properties/${property.id}/photos/${mediaId}`);
      setPhotos((prev) => prev.filter((p) => p.id !== mediaId));
    });

  const movePhoto = (index: number, dir: -1 | 1) =>
    run(async () => {
      if (!property) return;
      const next = [...photos];
      const [item] = next.splice(index, 1);
      next.splice(index + dir, 0, item);
      setPhotos(next);
      await apiPut(`/properties/${property.id}/photos/order`, { mediaIds: next.map((p) => p.id) });
    });

  const uploadDocument = (documentType: string, file: File) =>
    run(async () => {
      if (!property) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('documentType', documentType);
      await apiUpload(`/properties/${property.id}/documents`, fd);
      await loadDocuments(property.id);
    });

  const submit = () =>
    run(async () => {
      if (!property) return;
      await saveDraft();
      await apiPost(`/properties/${property.id}/submit`);
      router.push('/dashboard/listings');
    });

  const regionCenter = useMemo(() => {
    const r = regions.find((x) => x.slug === form.regionSlug);
    return { lat: r?.lat ?? 35.2, lng: r?.lng ?? 33.4 };
  }, [regions, form.regionSlug]);

  const inputCls = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5';
  const label = (key: string) => (
    <span className="text-sm font-medium text-gray-700">{t(`fields.${key}`)}</span>
  );

  // ── kind selection screen ──────────────────────────────────────────
  if (!property) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-bold">{t('wizard.title')}</h1>
        <p className="mt-1 text-gray-500">{t('wizard.chooseKind')}</p>
        <div className="mt-6 grid grid-cols-2 gap-4">
          {(['resale', 'rental'] as const).map((k) => (
            <button
              key={k}
              disabled={busy}
              onClick={() => startDraft(k)}
              className="rounded-xl border-2 border-gray-200 p-6 text-start hover:border-brand-500"
            >
              <span className="text-lg font-semibold">{t(`kind.${k}`)}</span>
              <p className="mt-1 text-sm text-gray-500">{t(`kindHint.${k}`)}</p>
            </button>
          ))}
        </div>
        {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">{t('wizard.title')}</h1>

      {/* stepper */}
      <ol className="mt-4 flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li
            key={s}
            className={`rounded-full px-3 py-1 font-medium ${
              i === stepIndex
                ? 'bg-brand-600 text-white'
                : i < stepIndex
                  ? 'bg-brand-50 text-brand-600'
                  : 'bg-gray-100 text-gray-400'
            }`}
          >
            {i + 1}. {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-4">
        {step === 'details' && (
          <>
            <label className="block">
              {label('title')}
              <input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="block">
              {label('description')}
              <textarea
                className={inputCls}
                rows={5}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                {label('price')}
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  value={form.priceAmount}
                  onChange={(e) => set('priceAmount', e.target.value)}
                />
              </label>
              <label className="block">
                {label('currency')}
                <select
                  className={inputCls}
                  value={form.priceCurrency}
                  onChange={(e) => set('priceCurrency', e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(['bedrooms', 'bathrooms', 'areaM2', 'plotM2'] as const).map((k) => (
                <label key={k} className="block">
                  {label(k)}
                  <input
                    className={inputCls}
                    type="number"
                    min={0}
                    value={form[k]}
                    onChange={(e) => set(k, e.target.value)}
                  />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                {label('deedType')}
                <select className={inputCls} value={form.deedType} onChange={(e) => set('deedType', e.target.value)}>
                  {DEED_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t(`deed.${d}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-7 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.furnished}
                  onChange={(e) => set('furnished', e.target.checked)}
                />
                <span className="text-sm">{t('fields.furnished')}</span>
              </label>
            </div>
          </>
        )}

        {step === 'location' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                {label('region')}
                <select
                  className={inputCls}
                  value={form.regionSlug}
                  onChange={(e) => set('regionSlug', e.target.value)}
                >
                  {regions.map((r) => (
                    <option key={r.slug} value={r.slug}>
                      {r.nameI18n[locale] ?? r.nameI18n.en}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                {label('district')}
                <input className={inputCls} value={form.district} onChange={(e) => set('district', e.target.value)} />
              </label>
            </div>
            <p className="text-sm text-gray-500">{t('wizard.mapHint')}</p>
            <MapPicker
              lat={form.lat}
              lng={form.lng}
              center={regionCenter}
              onChange={(lat, lng) => {
                set('lat', lat);
                set('lng', lng);
              }}
            />
            {form.lat && (
              <p className="text-xs text-gray-400">
                {form.lat}, {form.lng}
              </p>
            )}
          </>
        )}

        {step === 'features' && (
          <div className="flex flex-wrap gap-2">
            {FEATURE_KEYS.map((f) => {
              const active = form.features.includes(f);
              return (
                <button
                  key={f}
                  onClick={() =>
                    set('features', active ? form.features.filter((x) => x !== f) : [...form.features, f])
                  }
                  className={`rounded-full border px-4 py-2 text-sm ${
                    active ? 'border-brand-600 bg-brand-50 text-brand-600' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {t(`features.${f}`)}
                </button>
              );
            })}
          </div>
        )}

        {step === 'photos' && (
          <>
            <p className="text-sm text-gray-500">{t('wizard.photosHint')}</p>
            <label className="block cursor-pointer rounded-xl border-2 border-dashed border-gray-300 p-8 text-center text-gray-500 hover:border-brand-500">
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && uploadPhotos(e.target.files)}
              />
              {busy ? '…' : t('wizard.dropPhotos')}
            </label>
            <p className={`text-sm font-medium ${photos.length >= 5 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {t('wizard.photoCount', { count: photos.length })}
            </p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p, i) => (
                <li key={p.id} className="relative overflow-hidden rounded-lg border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-28 w-full object-cover" />
                  {i === 0 && (
                    <span className="absolute start-1 top-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {t('wizard.cover')}
                    </span>
                  )}
                  {p.duplicateWarning && (
                    <span className="absolute end-1 top-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {t('wizard.duplicate')}
                    </span>
                  )}
                  <div className="flex justify-between p-1 text-xs">
                    <span>
                      <button disabled={i === 0} onClick={() => movePhoto(i, -1)} className="px-1 disabled:opacity-30">←</button>
                      <button disabled={i === photos.length - 1} onClick={() => movePhoto(i, 1)} className="px-1 disabled:opacity-30">→</button>
                    </span>
                    <button onClick={() => removePhoto(p.id)} className="px-1 text-red-500">✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 'documents' && (
          <>
            <p className="text-sm text-gray-500">{t('wizard.documentsHint')}</p>
            {requirements.map((req) => {
              const uploaded = documents.filter((d) => d.documentType === req.documentType);
              return (
                <div key={req.documentType} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {req.titleI18n[locale] ?? req.titleI18n.en}
                        {req.isRequired && <span className="text-red-500"> *</span>}
                      </p>
                      {req.helpI18n && (
                        <p className="text-xs text-gray-500">{req.helpI18n[locale] ?? req.helpI18n.en}</p>
                      )}
                    </div>
                    <label className="shrink-0 cursor-pointer rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
                      <input
                        type="file"
                        accept=".pdf,image/*"
                        className="hidden"
                        onChange={(e) =>
                          e.target.files?.[0] && uploadDocument(req.documentType, e.target.files[0])
                        }
                      />
                      {t('wizard.upload')}
                    </label>
                  </div>
                  {uploaded.length > 0 && (
                    <p className="mt-2 text-sm text-emerald-600">
                      ✓ {t('wizard.uploadedCount', { count: uploaded.length })}
                    </p>
                  )}
                </div>
              );
            })}
          </>
        )}

        {step === 'review' && (
          <div className="rounded-xl border border-gray-200 p-5">
            <h2 className="text-lg font-semibold">{form.title || '—'}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t(`kind.${effectiveKind}`)} · {form.regionSlug} {form.district && `· ${form.district}`}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-gray-400">{t('fields.price')}</dt><dd className="font-medium">{form.priceAmount} {form.priceCurrency}</dd></div>
              <div><dt className="text-gray-400">{t('fields.bedrooms')}</dt><dd className="font-medium">{form.bedrooms || '—'}</dd></div>
              <div><dt className="text-gray-400">{t('fields.areaM2')}</dt><dd className="font-medium">{form.areaM2 || '—'} m²</dd></div>
              <div><dt className="text-gray-400">{t('fields.deedType')}</dt><dd className="font-medium">{t(`deed.${form.deedType}`)}</dd></div>
              <div><dt className="text-gray-400">{t('wizard.photos')}</dt><dd className="font-medium">{photos.length}</dd></div>
              <div><dt className="text-gray-400">{t('wizard.documents')}</dt><dd className="font-medium">{documents.length}</dd></div>
            </dl>
            <p className="mt-4 text-sm text-gray-500">{t('wizard.reviewHint')}</p>
          </div>
        )}

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {/* nav */}
        <div className="flex justify-between pt-2">
          <button
            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium disabled:opacity-40"
            disabled={busy || stepIndex === 0}
            onClick={() => goTo(STEPS[stepIndex - 1])}
          >
            {t('wizard.back')}
          </button>
          {step === 'review' ? (
            <button
              className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy}
              onClick={submit}
            >
              {t('wizard.submit')}
            </button>
          ) : (
            <button
              className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => goTo(STEPS[stepIndex + 1])}
            >
              {t('wizard.saveContinue')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ListingWizardPage() {
  return (
    <Suspense fallback={<p className="text-gray-400">…</p>}>
      <WizardInner />
    </Suspense>
  );
}
