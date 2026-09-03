'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { apiPost, getAccessToken } from '../../../lib/api';
import { Link } from '../../../i18n/routing';
import { CurrencySwitcher } from '../../../components/CurrencySwitcher';
import { useMoney } from '../../../lib/currency';
import { useCompare } from '../../../lib/compare';
import {
  API_BASE,
  POI_CATEGORIES,
  decodePolygon,
  encodePolygon,
  type LatLng,
  type PoiCategory,
  type PoiFeature,
  type RegionInfo,
  type RelaxableFilter,
  type SearchHit,
  type SearchSuggestions,
} from '../../../lib/listings';

const MapView = dynamic(() => import('../../../components/MapView'), { ssr: false });

function SearchInner() {
  const t = useTranslations('search');
  const locale = useLocale();
  const params = useSearchParams();
  const money = useMoney();
  const compare = useCompare();

  const [filters, setFilters] = useState({
    q: params.get('q') ?? '',
    kind: params.get('kind') ?? '',
    region: params.get('region') ?? '',
    minPrice: '',
    maxPrice: '',
    minBeds: '',
    deedType: '',
    sort: 'newest',
  });
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [totalHits, setTotalHits] = useState(0);
  const [suggestions, setSuggestions] = useState<SearchSuggestions | null>(null);
  const [view, setView] = useState<'list' | 'map'>(params.get('polygon') ? 'map' : 'list');
  const [savedMsg, setSavedMsg] = useState(false);
  const [scanLimited, setScanLimited] = useState(false);

  // §6.1 map-first UI. The drawn area is a filter like any other — it applies
  // to the list view too, which is why the chip below sits with the result
  // count rather than inside the map.
  const [polygon, setPolygon] = useState<LatLng[]>(() => decodePolygon(params.get('polygon')));
  const [drawing, setDrawing] = useState(false);
  const [poiCats, setPoiCats] = useState<PoiCategory[]>([]);
  const [pois, setPois] = useState<PoiFeature[]>([]);

  useEffect(() => {
    void fetch(`${API_BASE}/regions`).then((r) => r.json()).then(setRegions);
  }, []);

  // The catalogue is small and static, so it is fetched once and filtered in
  // the browser — toggling a layer should not cost a round trip.
  useEffect(() => {
    void fetch(`${API_BASE}/pois`)
      .then((r) => r.json())
      .then((data) => setPois(data.features ?? []))
      .catch(() => setPois([]));
  }, []);

  const runSearch = useCallback(async () => {
    const qs = new URLSearchParams();
    if (filters.q) qs.set('q', filters.q);
    if (filters.kind) qs.set('kind', filters.kind);
    if (filters.region) qs.set('region', filters.region);
    if (filters.minPrice) qs.set('minPrice', filters.minPrice);
    if (filters.maxPrice) qs.set('maxPrice', filters.maxPrice);
    if (filters.minBeds) qs.set('minBeds', filters.minBeds);
    if (filters.deedType) qs.set('deedType', filters.deedType);
    qs.set('sort', filters.sort);
    // Under three vertices there is no area yet, so a half-drawn shape must
    // not narrow the results — the user has not finished saying what they mean.
    if (polygon.length >= 3) qs.set('polygon', encodePolygon(polygon));
    const res = await fetch(`${API_BASE}/search/listings?${qs}`);
    const data = await res.json();
    setHits(data.hits ?? []);
    setTotalHits(data.totalHits ?? 0);
    setSuggestions(data.suggestions ?? null);
    setScanLimited(!!data.scanLimited);
  }, [filters, polygon]);

  /**
   * Drop one criterion and re-run — the `filters` effect picks the change up.
   * `furnished` is relaxable server-side but has no control on this page, so
   * it is filtered out of the suggestions rather than cleared here.
   */
  type ClearableFilter = Exclude<RelaxableFilter, 'furnished'>;
  const clearFilter = (key: ClearableFilter) => {
    // The drawn area is not a form field, so it is cleared rather than blanked.
    if (key === 'polygon') {
      setPolygon([]);
      setDrawing(false);
      return;
    }
    setFilters((f) => ({ ...f, [key]: '' }));
  };

  const clearAllFilters = () => {
    setPolygon([]);
    setDrawing(false);
    setFilters((f) => ({
      ...f,
      q: '',
      kind: '',
      region: '',
      minPrice: '',
      maxPrice: '',
      minBeds: '',
      deedType: '',
    }));
  };

  useEffect(() => {
    void runSearch();
  }, [runSearch]);

  const saveSearch = async () => {
    await apiPost('/users/me/saved-searches', {
      name: [filters.region, filters.kind].filter(Boolean).join(' ') || 'All listings',
      // The area goes into the saved query too, or the first alert would send
      // the user back to a map full of the pins they drew around.
      query: polygon.length >= 3 ? { ...filters, polygon: encodePolygon(polygon) } : filters,
    });
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
  };

  const selCls = 'rounded-lg border border-gray-300 px-3 py-2 text-sm';

  const relaxable = (suggestions?.relax ?? []).filter(
    (r): r is { filter: ClearableFilter; totalHits: number } => r.filter !== 'furnished',
  );

  const visiblePois = pois.filter((p) => poiCats.includes(p.properties.category));

  /**
   * Popup text. The local name is shown alongside the English one where they
   * differ, because that is the name on the road sign the buyer is looking for.
   */
  const poiLabel = useCallback(
    (poi: PoiFeature) => {
      const { name, nameTr, category } = poi.properties;
      const local = nameTr && nameTr !== name ? `<br/><span style="color:#6b7280">${nameTr}</span>` : '';
      return `<strong>${name}</strong>${local}<br/><span style="color:#6b7280">${t(`map.poi.${category}`)}</span>`;
    },
    [t],
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <div className="flex gap-2">
          {getAccessToken() && (
            <button onClick={saveSearch} className="rounded-lg border border-brand-600 px-4 py-2 text-sm font-medium text-brand-600">
              {savedMsg ? t('saved') : t('saveSearch')}
            </button>
          )}
          <button
            onClick={() => setView(view === 'list' ? 'map' : 'list')}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
          >
            {view === 'list' ? t('mapView') : t('listView')}
          </button>
        </div>
      </div>

      {/* filters */}
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          className={`${selCls} w-48`}
          placeholder={t('searchPlaceholder')}
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <select className={selCls} value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))}>
          <option value="">{t('anyKind')}</option>
          <option value="resale">{t('kind.resale')}</option>
          <option value="rental">{t('kind.rental')}</option>
        </select>
        <select className={selCls} value={filters.region} onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value }))}>
          <option value="">{t('anyRegion')}</option>
          {regions.map((r) => (
            <option key={r.slug} value={r.slug}>{r.nameI18n[locale] ?? r.nameI18n.en}</option>
          ))}
        </select>
        <input className={`${selCls} w-28`} type="number" placeholder={t('minPrice')} value={filters.minPrice} onChange={(e) => setFilters((f) => ({ ...f, minPrice: e.target.value }))} />
        <input className={`${selCls} w-28`} type="number" placeholder={t('maxPrice')} value={filters.maxPrice} onChange={(e) => setFilters((f) => ({ ...f, maxPrice: e.target.value }))} />
        <select className={selCls} value={filters.minBeds} onChange={(e) => setFilters((f) => ({ ...f, minBeds: e.target.value }))}>
          <option value="">{t('anyBeds')}</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>{n}+</option>
          ))}
        </select>
        <select className={selCls} value={filters.deedType} onChange={(e) => setFilters((f) => ({ ...f, deedType: e.target.value }))}>
          <option value="">{t('anyDeed')}</option>
          {['turkish', 'exchange', 'allocation', 'foreign'].map((d) => (
            <option key={d} value={d}>{t(`deed.${d}`)}</option>
          ))}
        </select>
        <select className={selCls} value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
          <option value="newest">{t('sortNewest')}</option>
          <option value="price_asc">{t('sortPriceAsc')}</option>
          <option value="price_desc">{t('sortPriceDesc')}</option>
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-gray-500">
            {t('results', { count: totalHits })}
            {/* An area search narrows in one pass, so a full box is a floor,
                not a total. Saying "1,000+" beats a confident wrong number. */}
            {scanLimited && <span className="text-gray-400"> {t('map.countCapped')}</span>}
          </p>
          {/* Visible in the list view as well: the area is still filtering
              there, and an invisible filter is how a user concludes the site
              is broken. */}
          {polygon.length >= 3 && (
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-500 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-600">
              {t('map.areaActive', { count: polygon.length })}
              <button
                type="button"
                onClick={() => clearFilter('polygon')}
                aria-label={t('map.clearArea')}
                className="text-brand-600/70 transition hover:text-brand-900"
              >
                ✕
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {compare.ids.length > 0 && (
            <Link
              href="/compare"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {t('compareCta', { count: compare.ids.length })}
            </Link>
          )}
          <CurrencySwitcher />
        </div>
      </div>

      {/* Zero results used to end here. Every route below was confirmed by the
          API to have listings behind it, so none of them lands on another
          empty page. */}
      {totalHits === 0 && suggestions && (
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-6">
          <p className="font-semibold text-gray-800">{t('noResults.title')}</p>
          <p className="mt-1 text-sm text-gray-500">{t('noResults.body')}</p>

          {relaxable.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t('noResults.widenLabel')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {relaxable.map((r) => (
                  <button
                    key={r.filter}
                    onClick={() => clearFilter(r.filter)}
                    className="rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm transition hover:border-brand-500 hover:text-brand-600"
                  >
                    {t(`noResults.drop.${r.filter}`)}{' '}
                    <span className="text-gray-400">({r.totalHits})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {suggestions.regions.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t('noResults.nearbyLabel')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.regions.map((r) => (
                  <button
                    key={r.slug}
                    onClick={() => setFilters((f) => ({ ...f, region: r.slug }))}
                    className="rounded-full border border-gray-300 bg-white px-4 py-1.5 text-sm transition hover:border-brand-500 hover:text-brand-600"
                  >
                    {r.nameI18n[locale] ?? r.nameI18n.en}{' '}
                    <span className="text-gray-400">
                      ({r.totalHits}
                      {r.distanceKm != null && ` · ${Math.round(r.distanceKm)} km`})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={clearAllFilters}
            className="mt-6 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-900"
          >
            {t('noResults.clearAll', { count: suggestions.totalLive })}
          </button>
        </div>
      )}

      {view === 'map' ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 rounded-t-xl border border-b-0 border-gray-200 bg-gray-50 px-3 py-2">
            {!drawing ? (
              <button
                type="button"
                onClick={() => {
                  setDrawing(true);
                  setPolygon([]);
                }}
                className="rounded-lg border border-brand-600 px-3 py-1.5 text-xs font-medium text-brand-600 transition hover:bg-brand-50"
              >
                {polygon.length >= 3 ? t('map.redraw') : t('map.draw')}
              </button>
            ) : (
              <>
                {/* Says what to do, because a bare crosshair cursor does not. */}
                <span className="text-xs text-gray-500">
                  {polygon.length < 3 ? t('map.drawHint') : t('map.finishHint')}
                </span>
                <button
                  type="button"
                  disabled={polygon.length < 3}
                  onClick={() => setDrawing(false)}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-40"
                >
                  {t('map.finish')}
                </button>
                <button
                  type="button"
                  disabled={polygon.length === 0}
                  onClick={() => setPolygon((pts) => pts.slice(0, -1))}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition disabled:opacity-40"
                >
                  {t('map.undoPoint')}
                </button>
              </>
            )}
            {(polygon.length > 0 || drawing) && (
              <button
                type="button"
                onClick={() => clearFilter('polygon')}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-400"
              >
                {t('map.clearArea')}
              </button>
            )}

            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-400">{t('map.poiLabel')}</span>
              {POI_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={poiCats.includes(c)}
                  onClick={() =>
                    setPoiCats((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]))
                  }
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    poiCats.includes(c)
                      ? 'border-brand-500 bg-brand-50 text-brand-600'
                      : 'border-gray-300 text-gray-600 hover:border-brand-500'
                  }`}
                >
                  {t(`map.poi.${c}`)}
                </button>
              ))}
            </span>
          </div>
          <MapView
            className="h-[32rem] w-full rounded-b-xl border border-gray-200"
            center={{ lat: 35.25, lng: 33.4 }}
            polygon={polygon}
            drawing={drawing}
            onPolygonChange={setPolygon}
            onFinishDraw={() => setDrawing(false)}
            pois={visiblePois}
            poiLabel={poiLabel}
            markers={hits
              .filter((h) => h._geo)
              .map((h) => ({
                id: h.id,
                lat: h._geo!.lat,
                lng: h._geo!.lng,
                label: `${h.title} — ${money.format(h.priceBaseGbp)}`,
                href: `/${locale}/listing/${h.id}`,
              }))}
          />
          <p className="mt-2 text-xs text-gray-400">{t('map.poiDisclaimer')}</p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hits.map((h) => (
            <li key={h.id} className="overflow-hidden rounded-xl border border-gray-200 transition hover:shadow-md">
              <Link href={`/listing/${h.id}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {h.coverUrl ? (
                  <img src={h.coverUrl} alt={h.title} className="h-44 w-full object-cover" />
                ) : (
                  <div className="flex h-44 w-full items-center justify-center bg-gray-100 text-3xl">🏠</div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">✓ {t('verified')}</span>
                    {h.deedType !== 'na' && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{t(`deed.${h.deedType}`)}</span>
                    )}
                  </div>
                  <p className="mt-2 truncate font-semibold">{h.title}</p>
                  <p className="text-sm text-gray-500">
                    {h.regionName}
                    {h.district && ` · ${h.district}`}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">
                    {h.bedrooms != null && `${h.bedrooms} ${t('beds')} · `}
                    {h.bathrooms != null && `${h.bathrooms} ${t('baths')} · `}
                    {h.areaM2 != null && `${h.areaM2} m²`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-2">
                    <p className="text-lg font-bold text-brand-600">{money.format(h.priceBaseGbp)}</p>
                    {/* §6.1: a listing that has come down is the strongest
                        signal on the card, so it sits beside the price. */}
                    {h.priceReducedPct ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        {t('reducedBy', { pct: h.priceReducedPct })}
                      </span>
                    ) : null}
                  </div>
                  {/* Inside the card but outside the Link: adding to a
                      shortlist must not navigate away from the results. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      compare.toggle(h.id);
                    }}
                    disabled={compare.full && !compare.has(h.id)}
                    className={`mt-2 w-full rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                      compare.has(h.id)
                        ? 'border-brand-500 bg-brand-50 text-brand-600'
                        : 'border-gray-300 text-gray-600 hover:border-brand-500'
                    }`}
                  >
                    {compare.has(h.id) ? t('inCompare') : t('addCompare')}
                  </button>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="p-8 text-gray-400">…</p>}>
      <SearchInner />
    </Suspense>
  );
}
