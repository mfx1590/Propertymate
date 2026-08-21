/**
 * Self-contained integration test for zero-result search recovery (Plan §0 UX
 * pass, §6.1 search):
 *   1. suggestions appear only when a search finds nothing — a page with hits
 *      carries no recovery payload at all
 *   2. the criterion actually responsible for the empty page is the one
 *      offered, with the count it would return
 *   3. a relaxation that would still return nothing is never offered — that is
 *      the whole point, since the old empty page was already a dead end
 *   4. every suggestion is honest: applying it returns exactly the promised
 *      count
 *   5. nearby regions are the regions that really do hold this search, nearest
 *      first by real distance, and never the region already selected
 *   6. `totalLive` matches an unfiltered search, so "clear all filters" cannot
 *      land on another empty page
 *   7. recovery is public — a signed-out visitor is the one most likely to
 *      hit it
 *
 * Every listing asserted on is created here and tagged with a unique token, so
 * the suite is immune to whatever demo data a dev database happens to hold.
 * Run against a live API: `npm run test:e2e:search`.
 */
const API = process.env.API_BASE ?? 'http://localhost:4000';
const results = [];
let failed = 0;
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, { token, body, form, sessionKey } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sessionKey) headers['x-session-key'] = sessionKey;
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-search')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

/** GET /search/listings with a filter object, as the public site calls it. */
function search(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  return req('GET', `/search/listings?${qs}`);
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  // A nonsense token no demo listing can contain, so every count below is
  // about this suite's own rows and nothing else in the database.
  const TAG = `zqxsrch${u}`;
  // 53x is a real Turkish mobile range — `IsPhoneNumber` checks operator
  // prefixes, not just the shape, so an invented one is rejected at signup.
  const ownerPhone = `+9053${u}2`;

  const owner = await otp(ownerPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });

  const regions = await req('GET', '/regions');
  const coordsOf = (slug) => regions.find((r) => r.slug === slug) ?? {};

  /** Publishes one live rental listing (rentals go public on approval). */
  async function publish({ label, regionSlug, price, bedrooms, deedType }) {
    const { lat, lng } = coordsOf(regionSlug);
    const p = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
    await req('PUT', `/properties/${p.id}`, {
      token: owner,
      body: {
        title: `${TAG} ${label}`,
        description: `Listing ${label} used to exercise zero-result search recovery.`,
        regionSlug, lat: lat ?? 35.2, lng: lng ?? 33.4,
        priceAmount: price, priceCurrency: 'GBP',
        bedrooms, bathrooms: 1, areaM2: 70 + bedrooms * 10,
        deedType, furnished: true,
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

  await publish({ label: 'FAMA', regionSlug: 'famagusta', price: 900, bedrooms: 2, deedType: 'turkish' });
  await publish({ label: 'KYR', regionSlug: 'kyrenia', price: 2000, bedrooms: 3, deedType: 'turkish' });
  await publish({ label: 'ISK', regionSlug: 'iskele', price: 700, bedrooms: 1, deedType: 'exchange' });

  // Indexing is event-driven off the local bus — wait for all three to land.
  let indexed = 0;
  for (let i = 0; i < 40; i++) {
    indexed = (await search({ q: TAG })).totalHits;
    if (indexed === 3) break;
    await sleep(500);
  }
  ok('0a the suite indexed exactly its own three listings', indexed === 3, `${indexed}`);

  // ── 1. suggestions only on an empty page ─────────────────────────
  const withHits = await search({ q: TAG });
  ok('1a a search with results carries no recovery payload', withHits.suggestions === undefined, JSON.stringify(withHits.suggestions ?? null));

  const blocked = await search({ q: TAG, minBeds: 5 });
  ok('1b an impossible filter finds nothing', blocked.totalHits === 0, `${blocked.totalHits}`);
  ok('1c a zero-result page carries recovery suggestions', !!blocked.suggestions);

  // ── 2. the blocking criterion is the one offered ─────────────────
  const bedsHint = blocked.suggestions.relax.find((r) => r.filter === 'minBeds');
  ok('2a the criterion actually responsible is offered', !!bedsHint, blocked.suggestions.relax.map((r) => r.filter).join(','));
  ok('2b it is offered with the count dropping it returns', bedsHint?.totalHits === 3, `${bedsHint?.totalHits}`);

  // ── 3. a relaxation that stays empty is never offered ────────────
  // Neither criterion alone unblocks this: no listing here has 5+ beds, and
  // none has a foreign deed, so dropping either still returns nothing.
  const doubleBlocked = await search({ q: TAG, minBeds: 5, deedType: 'foreign' });
  ok('3a two impossible filters find nothing', doubleBlocked.totalHits === 0, `${doubleBlocked.totalHits}`);
  const offered = doubleBlocked.suggestions.relax.map((r) => r.filter);
  ok('3b dropping beds alone is not offered when it would still be empty', !offered.includes('minBeds'), offered.join(','));
  ok('3c dropping the deed type alone is not offered either', !offered.includes('deedType'), offered.join(','));
  ok('3d no suggestion ever promises zero results', doubleBlocked.suggestions.relax.every((r) => r.totalHits > 0), JSON.stringify(doubleBlocked.suggestions.relax));

  // ── 4. every suggestion is honest ────────────────────────────────
  // The promise the UI makes is that each button lands on results. Apply each
  // one and check the page it produces matches the number on the button.
  const base = { q: TAG, minBeds: 5 };
  let honest = true;
  const mismatches = [];
  for (const r of blocked.suggestions.relax) {
    const applied = await search({ ...base, [r.filter]: undefined });
    if (applied.totalHits !== r.totalHits) {
      honest = false;
      mismatches.push(`${r.filter}: promised ${r.totalHits}, got ${applied.totalHits}`);
    }
  }
  ok('4a applying a suggestion returns exactly the promised count', honest, mismatches.join('; '));

  // ── 5. nearby regions ────────────────────────────────────────────
  // Nicosia holds none of this suite's listings, so the other three regions
  // are the way out.
  const wrongRegion = await search({ q: TAG, region: 'nicosia' });
  ok('5a a region with no matches finds nothing', wrongRegion.totalHits === 0, `${wrongRegion.totalHits}`);
  const nearby = wrongRegion.suggestions.regions;
  ok('5b the regions that do hold this search are offered', nearby.length === 3, nearby.map((r) => r.slug).join(','));
  ok('5c the already-selected region is never suggested', !nearby.some((r) => r.slug === 'nicosia'), nearby.map((r) => r.slug).join(','));
  ok('5d each nearby region carries its own count', nearby.every((r) => r.totalHits === 1), JSON.stringify(nearby.map((r) => [r.slug, r.totalHits])));
  ok(
    '5e nearby means nearby — ordered by real distance',
    nearby.every((r, i) => i === 0 || r.distanceKm >= nearby[i - 1].distanceKm),
    nearby.map((r) => `${r.slug}=${Math.round(r.distanceKm)}km`).join(','),
  );
  const firstNearby = await search({ q: TAG, region: nearby[0].slug });
  ok('5f switching to a suggested region actually finds listings', firstNearby.totalHits === nearby[0].totalHits, `${firstNearby.totalHits} vs ${nearby[0].totalHits}`);

  // ── 6. clear-all is a guaranteed way out ─────────────────────────
  const unfiltered = await search({});
  ok('6a totalLive matches an unfiltered search', blocked.suggestions.totalLive === unfiltered.totalHits, `${blocked.suggestions.totalLive} vs ${unfiltered.totalHits}`);
  ok('6b clearing every filter cannot land on another empty page', blocked.suggestions.totalLive >= 3, `${blocked.suggestions.totalLive}`);

  // A search whose words match nothing at all still offers a way back.
  const nonsense = await search({ q: `${TAG}nomatchatall` });
  ok('6c an unmatchable query still offers recovery', nonsense.totalHits === 0 && !!nonsense.suggestions, `${nonsense.totalHits}`);
  const dropQ = nonsense.suggestions.relax.find((r) => r.filter === 'q');
  ok('6d dropping the search words is offered', !!dropQ && dropQ.totalHits === unfiltered.totalHits, `${dropQ?.totalHits} vs ${unfiltered.totalHits}`);

  // ── 7. recovery is public ────────────────────────────────────────
  // Every request in this section ran signed-out; assert it explicitly so a
  // future auth guard on search cannot silently break the empty-state route.
  const anon = await search({ q: TAG, minBeds: 5 });
  ok('7a a signed-out visitor gets the same suggestions', !!anon.suggestions && anon.suggestions.relax.length > 0);
  const payload = JSON.stringify(anon.suggestions);
  ok('7b the payload leaks no internal ids', !payload.includes('createdByUserId') && !payload.includes('publishedByAgentId'));

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL SEARCH-SUGGESTION E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
