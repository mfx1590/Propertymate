/**
 * Self-contained integration test for the §6.1 map-first surface — the
 * polygon-draw filter and the POI layers.
 *
 * What it is really testing is the gap between a bounding box and a polygon.
 * Meilisearch 1.11 can filter by box but not by shape, so the API narrows the
 * box by hand; every check below exists because "close enough to the box" is
 * the failure this feature can plausibly ship with and nobody would notice on
 * a rectangular test area. The listings are therefore laid out around a right
 * triangle, with one of them parked in the corner of the box that the triangle
 * does not cover:
 *
 *      B(35.20, 32.60)
 *      |\                      · CORNER (35.18, 32.78)
 *      | \                       — inside the box, outside the shape
 *      |  \
 *      | · \  INSIDE (35.04, 32.64)
 *      |____\
 *      A      C(35.00, 32.80)
 *
 *   1. an area returns the listings inside it and nothing else
 *   2. a listing inside the bounding box but outside the drawn shape is NOT
 *      returned — the check that separates this from a box filter
 *   3. an area combines with the other filters rather than replacing them
 *   4. a malformed area is refused, not silently ignored, and a degenerate one
 *      returns nothing rather than crashing
 *   5. an area that finds nothing offers dropping the area, with an honest
 *      count — and stops offering nearby regions, whose counts come from the
 *      box and would overstate
 *   6. a saved search remembers its area, so an alert never announces a
 *      listing the user drew around (the same box-vs-shape trap, one layer
 *      down, where nobody would ever see it)
 *   7. POI layers are public GeoJSON in the right coordinate order, filterable
 *      by category, and "nearest" really is the nearest
 *
 * Not covered, and not fakeable: a listing with no coordinates can never be
 * inside an area. Submit validation refuses a listing without a map pin, so
 * there is no way to create one — the exclusion comes from the bounding-box
 * filter, which matches no document lacking `_geo`.
 *
 * Every listing asserted on is created here and tagged, so the suite is immune
 * to whatever demo data a database happens to hold. The saved search it creates
 * is deleted in `finally` — left behind, it would be swept by every later suite
 * that triggers an alert run.
 *
 * Run against a live API: `npm run test:e2e:map`.
 */
const API = process.env.API_BASE ?? 'http://localhost:4000';
const results = [];
let failed = 0;
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  return json;
}

async function expectFail(method, path, opts = {}) {
  try {
    await req(method, path, opts);
    return 0;
  } catch (e) {
    return Number(/-> (\d+):/.exec(e.message)?.[1] ?? -1);
  }
}

/** Meilisearch indexes asynchronously; poll rather than guess a sleep. */
async function retry(fn, predicate, tries = 25, gap = 400) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(gap);
  }
  return last;
}

async function otp(phone, accountType) {
  let r;
  for (let attempt = 0; ; attempt++) {
    try {
      r = await req('POST', '/auth/otp/request', { body: { phone } });
      break;
    } catch (e) {
      if (!e.message.includes('-> 429') || attempt >= 5) throw e;
      console.log('  (OTP rate limit hit — waiting out the window)');
      await sleep(20_000);
    }
  }
  const v = await req('POST', '/auth/otp/verify', { body: { phone, code: r.devCode, accountType } });
  return v.accessToken;
}

const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';
function jpeg() {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(JPEG_B64, 'base64')], { type: 'image/jpeg' }), 'x.jpg');
  return fd;
}
function pdf(documentType) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-map')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

function search(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  return req('GET', `/search/listings?${qs}`);
}

const encode = (pts) => pts.map(([lat, lng]) => `${lat},${lng}`).join(';');

// The right triangle drawn above. A, B, C in click order.
const TRIANGLE = encode([[35.0, 32.6], [35.2, 32.6], [35.0, 32.8]]);
// Its bounding box — the shape a box-only filter would effectively apply.
const TRIANGLE_BOX = encode([[35.0, 32.6], [35.2, 32.6], [35.2, 32.8], [35.0, 32.8]]);
// Somewhere in the Karpaz, nowhere near either.
const ELSEWHERE = encode([[35.5, 34.3], [35.6, 34.3], [35.6, 34.5], [35.5, 34.5]]);

const EARTH_RADIUS_KM = 6371;
const km = (aLat, aLng, bLat, bLng) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const TAG = `zqxmapp${u}`;
  const ownerPhone = `+9053${u}3`;
  const buyerPhone = `+9053${u}4`;

  const owner = await otp(ownerPhone, 'owner');
  const buyer = await otp(buyerPhone, 'customer');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });

  let savedSearchId = null;
  try {
    /**
     * One live rental at an exact coordinate. Every listing here sits in the
     * same region on purpose: the area filter must do its work geographically,
     * not by quietly agreeing with a region filter.
     */
    async function publish({ label, lat, lng, bedrooms = 2, price = 900 }) {
      const p = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
      await req('PUT', `/properties/${p.id}`, {
        token: owner,
        body: {
          title: `${TAG} ${label}`,
          description: `Listing ${label} used to exercise the drawn-area filter.`,
          regionSlug: 'lefke', lat, lng,
          priceAmount: price, priceCurrency: 'GBP',
          bedrooms, bathrooms: 1, areaM2: 70 + bedrooms * 10,
          deedType: 'turkish', furnished: true,
        },
      });
      for (let i = 0; i < 5; i++) await req('POST', `/properties/${p.id}/photos`, { token: owner, form: jpeg() });
      for (const dt of ['title_deed', 'owner_id']) {
        await req('POST', `/properties/${p.id}/documents`, { token: owner, form: pdf(dt) });
      }
      await req('POST', `/properties/${p.id}/submit`, { token: owner });

      const queue = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
      const item = queue.find((q) => q.entityId === p.id);
      const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
      await req('POST', `/admin/verification/${item.id}/decision`, {
        token: admin,
        body: { documentDecisions: detail.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
      });
      return p.id;
    }

    const insideId = await publish({ label: 'INSIDE', lat: 35.04, lng: 32.64 });
    // Inside the triangle's bounding box, outside the triangle itself.
    // Priced apart from the others so the sort check below has something to
    // order; same price on both would pass a `>=` assertion saying nothing.
    const cornerId = await publish({ label: 'CORNER', lat: 35.18, lng: 32.78, bedrooms: 4, price: 1500 });
    // Outside both.
    const farId = await publish({ label: 'FAR', lat: 35.5, lng: 33.9 });

    const indexed = await retry(() => search({ q: TAG }), (r) => r.totalHits === 3);
    ok('0a the suite indexed exactly its own three listings', indexed.totalHits === 3, `${indexed.totalHits}`);

    // ── 1. an area returns what is inside it ─────────────────────────
    const drawn = await search({ q: TAG, polygon: TRIANGLE });
    const drawnIds = drawn.hits.map((h) => h.id);
    ok('1a the drawn area returns the listing inside it', drawnIds.includes(insideId), drawnIds.join(','));
    ok('1b and only that one', drawn.totalHits === 1, `${drawn.totalHits}: ${drawnIds.join(',')}`);
    ok('1c a listing far outside the area is excluded', !drawnIds.includes(farId));
    ok('1d the count and the page agree', drawn.hits.length === drawn.totalHits && drawn.totalPages === 1, `${drawn.hits.length}/${drawn.totalHits}/${drawn.totalPages}`);
    ok('1e nothing was truncated at this size', drawn.scanLimited === false, `${drawn.scanLimited}`);

    // ── 2. the box is not the shape ──────────────────────────────────
    // The corner listing sits inside the polygon's bounding box. A filter that
    // stopped at the box would return it for the triangle too, and this is the
    // only pair of checks in the suite that would fail if it did.
    const boxHits = await search({ q: TAG, polygon: TRIANGLE_BOX });
    ok('2a the corner listing IS inside the bounding box', boxHits.hits.map((h) => h.id).includes(cornerId), boxHits.hits.map((h) => h.id).join(','));
    ok('2b the box holds both of the near listings', boxHits.totalHits === 2, `${boxHits.totalHits}`);
    ok('2c but the triangle excludes the corner one', !drawnIds.includes(cornerId), drawnIds.join(','));

    const elsewhere = await search({ q: TAG, polygon: ELSEWHERE });
    ok('2d an area over empty ground finds nothing', elsewhere.totalHits === 0, `${elsewhere.totalHits}`);

    // ── 3. an area is a filter among filters ─────────────────────────
    const withBeds = await search({ q: TAG, polygon: TRIANGLE_BOX, minBeds: 4 });
    ok('3a area AND beds narrows to the one that satisfies both', withBeds.totalHits === 1 && withBeds.hits[0].id === cornerId, `${withBeds.totalHits}`);
    const withKind = await search({ q: TAG, polygon: TRIANGLE_BOX, kind: 'resale' });
    ok('3b area AND a kind nothing here matches finds nothing', withKind.totalHits === 0, `${withKind.totalHits}`);
    const paged = await search({ q: TAG, polygon: TRIANGLE_BOX, page: 2 });
    ok('3c page 2 of a single-page area is empty, not a repeat of page 1', paged.hits.length === 0 && paged.totalHits === 2, `${paged.hits.length}/${paged.totalHits}`);
    const sorted = await search({ q: TAG, polygon: TRIANGLE_BOX, sort: 'price_desc' });
    ok('3d sorting still applies inside an area', sorted.hits.length === 2 && sorted.hits[0].priceBaseGbp > sorted.hits[1].priceBaseGbp, sorted.hits.map((h) => h.priceBaseGbp).join(','));
    const sortedAsc = await search({ q: TAG, polygon: TRIANGLE_BOX, sort: 'price_asc' });
    ok('3e and reverses when the sort does', sortedAsc.hits[0]?.id !== sorted.hits[0]?.id, `${sortedAsc.hits[0]?.id} vs ${sorted.hits[0]?.id}`);

    // ── 4. a bad area is refused, not ignored ────────────────────────
    ok('4a two points are not an area', (await expectFail('GET', `/search/listings?polygon=${encode([[35, 32.6], [35.2, 32.6]])}`)) === 400);
    ok('4b a non-numeric point is refused', (await expectFail('GET', '/search/listings?polygon=35,32.6;abc,32.7;35.1,32.8')) === 400);
    ok('4c a point off the globe is refused', (await expectFail('GET', '/search/listings?polygon=95,32.6;35.2,32.6;35,32.8')) === 400);
    const tooMany = encode(Array.from({ length: 201 }, (_, i) => [35 + i / 10000, 32.6 + i / 10000]));
    ok('4d an absurd number of points is refused', (await expectFail('GET', `/search/listings?polygon=${tooMany}`)) === 400);
    // Three identical points enclose nothing. It has to answer, not throw.
    const degenerate = await search({ q: TAG, polygon: encode([[35.04, 32.64], [35.04, 32.64], [35.04, 32.64]]) });
    ok('4e a degenerate area returns nothing rather than erroring', degenerate.totalHits === 0, `${degenerate.totalHits}`);

    // ── 5. the way out of an empty area ──────────────────────────────
    ok('5a an empty area carries recovery suggestions', !!elsewhere.suggestions);
    const dropArea = elsewhere.suggestions.relax.find((r) => r.filter === 'polygon');
    ok('5b dropping the drawn area is offered', !!dropArea, elsewhere.suggestions.relax.map((r) => r.filter).join(','));
    ok('5c with the count dropping it really returns', dropArea?.totalHits === 3, `${dropArea?.totalHits}`);
    const applied = await search({ q: TAG });
    ok('5d applying it lands on exactly that many listings', applied.totalHits === dropArea?.totalHits, `${applied.totalHits} vs ${dropArea?.totalHits}`);

    // Nearby regions are offered without an area…
    const noArea = await search({ q: TAG, region: 'nicosia' });
    ok('5e without an area, an empty region search still offers nearby regions', noArea.suggestions.regions.length > 0, `${noArea.suggestions.regions.length}`);
    // …and suppressed with one, because their counts come from the box.
    const withAreaToo = await search({ q: TAG, region: 'nicosia', polygon: ELSEWHERE });
    ok('5f with an area drawn, nearby regions are not offered', withAreaToo.suggestions.regions.length === 0, JSON.stringify(withAreaToo.suggestions.regions));

    // ── 6. a saved search remembers its area ─────────────────────────
    const saved = await req('POST', '/users/me/saved-searches', {
      token: buyer,
      body: { name: `Area ${u}`, query: { q: TAG, polygon: TRIANGLE } },
    });
    savedSearchId = saved.id;
    ok('6a the search saved with its area', !!saved.id && saved.query.polygon === TRIANGLE);

    // Everything published so far predates the save, so the first sweep is silent.
    await req('POST', '/admin/jobs/saved-search-alerts', { token: admin });
    const noteCount = async () =>
      (await req('GET', '/users/me/notifications', { token: buyer }))
        .filter((n) => n.templateKey === 'discovery.new_matches').length;
    ok('6b nothing that already existed is announced as new', (await noteCount()) === 0);

    // A new listing inside the BOX but outside the SHAPE. A sweep that filtered
    // by box would alert here — and on a nightly job nobody would ever catch it.
    const newCorner = await publish({ label: 'ALERT-CORNER', lat: 35.17, lng: 32.77 });
    await retry(() => search({ q: TAG }), (r) => r.hits.some((h) => h.id === newCorner));
    await req('POST', '/admin/jobs/saved-search-alerts', { token: admin });
    ok('6c a listing outside the saved area does not alert', (await noteCount()) === 0);

    // One genuinely inside it does.
    const newInside = await publish({ label: 'ALERT-INSIDE', lat: 35.05, lng: 32.63 });
    await retry(() => search({ q: TAG }), (r) => r.hits.some((h) => h.id === newInside));
    await req('POST', '/admin/jobs/saved-search-alerts', { token: admin });
    const notes = await retry(
      () => req('GET', '/users/me/notifications', { token: buyer }),
      (n) => n.some((x) => x.templateKey === 'discovery.new_matches'),
    );
    const note = notes.find((n) => n.templateKey === 'discovery.new_matches');
    ok('6d a listing inside the saved area does alert', !!note, `${notes.length} notifications`);
    ok('6e and counts only the one inside it', note?.payload?.count === 1, JSON.stringify(note?.payload));

    // ── 7. POI layers ───────────────────────────────────────────────
    // Every request in this section is signed out: the map is the first thing
    // an anonymous visitor touches.
    const all = await req('GET', '/pois');
    ok('7a POIs are public GeoJSON', all.type === 'FeatureCollection' && Array.isArray(all.features), JSON.stringify(all.type));
    const cats = new Set(all.features.map((f) => f.properties.category));
    ok('7b all three §6.1 layers are seeded', cats.has('university') && cats.has('beach') && cats.has('hospital'), [...cats].join(','));
    ok('7c every feature is a named point', all.features.every((f) => f.geometry?.type === 'Point' && f.properties?.name));

    // GeoJSON is [lng, lat] and the rest of this codebase is {lat, lng}. A flip
    // here would put every campus in the Indian Ocean and still render a map.
    const emu = all.features.find((f) => f.id === 'emu');
    ok('7d coordinates are GeoJSON order — [lng, lat]', !!emu && Math.abs(emu.geometry.coordinates[0] - 33.908) < 0.01 && Math.abs(emu.geometry.coordinates[1] - 35.1418) < 0.01, JSON.stringify(emu?.geometry.coordinates));
    ok('7e every point lands in northern Cyprus', all.features.every((f) => {
      const [lng, lat] = f.geometry.coordinates;
      return lat > 34.9 && lat < 35.8 && lng > 32.2 && lng < 34.7;
    }));

    const beaches = await req('GET', '/pois?category=beach');
    ok('7f a category filter narrows the layer', beaches.features.length > 0 && beaches.features.every((f) => f.properties.category === 'beach'), `${beaches.features.length}`);
    const hospitals = await req('GET', '/pois?category=hospital');
    const two = await req('GET', '/pois?category=beach,hospital');
    ok('7g several categories return their union', two.features.length === beaches.features.length + hospitals.features.length, `${two.features.length}`);
    ok('7h an unknown category is refused rather than silently empty', (await expectFail('GET', '/pois?category=airports')) === 400);

    // Nearest, checked against the whole catalogue rather than against itself.
    const point = { lat: 35.34, lng: 33.32 };
    const near = await req('GET', `/pois/near?lat=${point.lat}&lng=${point.lng}`);
    ok('7i nearest returns one of each category', near.length === 3 && new Set(near.map((n) => n.category)).size === 3, JSON.stringify(near.map((n) => n.category)));
    let allNearest = true;
    const wrong = [];
    for (const n of near) {
      const best = all.features
        .filter((f) => f.properties.category === n.category)
        .map((f) => ({ id: f.id, d: km(point.lat, point.lng, f.geometry.coordinates[1], f.geometry.coordinates[0]) }))
        .sort((a, b) => a.d - b.d)[0];
      if (best.id !== n.id) { allNearest = false; wrong.push(`${n.category}: got ${n.id}, nearest is ${best.id}`); }
      if (Math.abs(best.d - n.distanceKm) > 0.15) { allNearest = false; wrong.push(`${n.category}: distance ${n.distanceKm} vs ${best.d.toFixed(2)}`); }
    }
    ok('7j "nearest" is the nearest, at the distance it claims', allNearest, wrong.join('; '));
    ok('7k out-of-range coordinates are refused', (await expectFail('GET', '/pois/near?lat=91&lng=33')) === 400);
    ok('7l a missing coordinate is refused', (await expectFail('GET', '/pois/near?lat=35')) === 400);
  } finally {
    // A saved search left behind is swept by every later alert run in this
    // database, alerting a phantom user forever. Removed on failure too.
    if (savedSearchId) {
      await req('DELETE', `/users/me/saved-searches/${savedSearchId}`, { token: buyer }).catch(() => undefined);
    }
  }

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL MAP-SEARCH E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
