/**
 * Self-contained integration test for the region landing-page data (§6.1 SEO):
 *   1. the endpoint is public — a landing page must render for a crawler with
 *      no account
 *   2. counts cover only what the public can see: drafts and pending listings
 *      are excluded
 *   3. sale and rent are summarised separately — averaging a £200k purchase
 *      with a £900 rent would describe nothing
 *   4. the median is a median, not a mean, so one outlier cannot move it
 *   5. the deed-type breakdown counts every public listing
 *   6. an unknown slug 404s rather than rendering an empty page
 *
 * Creates its own region-scoped listings and asserts on deltas rather than
 * absolutes, so it is correct against both an empty CI database and a dev
 * database full of demo data.
 * Run against a live API: `npm run test:e2e:regions`.
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-regions')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

// Güzelyurt is the quietest region in the demo seed, which keeps the deltas
// this suite measures small and easy to reason about.
const REGION = 'guzelyurt';

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;

  // ── 1. public access ─────────────────────────────────────────────
  const before = await req('GET', `/regions/${REGION}`);
  ok('1a the region endpoint is public', typeof before.stats?.total === 'number', JSON.stringify(before.stats ?? before).slice(0, 120));
  ok('1b it carries the localisable name', !!before.nameI18n?.en, JSON.stringify(before.nameI18n));
  ok('1c and coordinates for the map/schema', typeof before.lat === 'number' && typeof before.lng === 'number');

  const u = `${Date.now()}`.slice(-7);
  const landlord = await otp(`+9053${u}1`, 'owner');
  await req('POST', '/admin/subscriptions/grant', {
    token: admin,
    body: { identifier: `+9053${u}1`, planKey: 'owner_basic', months: 12 },
  });

  async function draftRental(title, price, area) {
    const p = await req('POST', '/properties', { token: landlord, body: { kind: 'rental' } });
    await req('PUT', `/properties/${p.id}`, {
      token: landlord,
      body: {
        title,
        description: 'Listing used to exercise the §6.1 region landing-page statistics.',
        regionSlug: REGION, lat: 35.2, lng: 32.99,
        priceAmount: price, priceCurrency: 'GBP', bedrooms: 2, bathrooms: 1, areaM2: area,
        deedType: 'turkish', furnished: true,
      },
    });
    return p;
  }
  async function publish(p) {
    for (let i = 0; i < 5; i++) await req('POST', `/properties/${p.id}/photos`, { token: landlord, form: jpeg() });
    for (const dt of ['title_deed', 'owner_id', 'utility_bill']) {
      await req('POST', `/properties/${p.id}/documents`, { token: landlord, form: pdf(dt) });
    }
    await req('POST', `/properties/${p.id}/submit`, { token: landlord });
    const queue = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
    const item = queue.find((q) => q.entityId === p.id);
    const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
    await req('POST', `/admin/verification/${item.id}/decision`, {
      token: admin,
      body: { documentDecisions: detail.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
    });
  }

  // ── 2. only public listings are counted ──────────────────────────
  const draftOnly = await draftRental(`Region draft ${u}`, 5000, 100);
  const afterDraft = await req('GET', `/regions/${REGION}`);
  ok(
    '2a a draft is not counted',
    afterDraft.stats.total === before.stats.total,
    `${before.stats.total} → ${afterDraft.stats.total}`,
  );

  // Three rents: 600, 800, 100000. The median must ignore the outlier.
  const rents = [];
  for (const [i, price] of [600, 800, 100000].entries()) {
    const p = await draftRental(`Region rent ${u}-${i}`, price, 100);
    await publish(p);
    rents.push(p);
  }

  const after = await req('GET', `/regions/${REGION}`);
  ok(
    '2b published listings are counted',
    after.stats.total === before.stats.total + 3,
    `${before.stats.total} → ${after.stats.total}`,
  );
  ok(
    '2c the draft is still excluded',
    after.stats.total === before.stats.total + 3,
    `draft ${draftOnly.id} must not appear`,
  );

  // ── 3. sale and rent summarised separately ───────────────────────
  ok(
    '3a rentals land in the rent band',
    after.stats.rent.count === before.stats.rent.count + 3,
    `${before.stats.rent.count} → ${after.stats.rent.count}`,
  );
  ok(
    '3b and not in the sale band',
    after.stats.sale.count === before.stats.sale.count,
    `${before.stats.sale.count} → ${after.stats.sale.count}`,
  );
  ok('3c the two bands are separate objects', after.stats.sale !== after.stats.rent);

  // ── 4. median, not mean ──────────────────────────────────────────
  // A mean over 600 / 800 / 100000 is ~33,800. A median is 800. If the demo
  // seed contributes nothing to this region the median is exactly 800; where
  // it does, the assertion that matters is simply that the outlier has not
  // dragged the figure into its own neighbourhood.
  ok(
    '4a one £100k outlier does not drag the median up',
    after.stats.rent.medianGbp !== null && after.stats.rent.medianGbp < 10000,
    `median ${after.stats.rent.medianGbp}`,
  );
  ok(
    '4b the max still records the outlier',
    (after.stats.rent.maxGbp ?? 0) >= 100000,
    `max ${after.stats.rent.maxGbp}`,
  );
  ok(
    '4c a per-m² median is derived where area is known',
    typeof after.stats.rent.medianPerM2 === 'number',
    `${after.stats.rent.medianPerM2}`,
  );

  // ── 5. deed breakdown ────────────────────────────────────────────
  const beforeTurkish = before.stats.deedTypes.turkish ?? 0;
  ok(
    '5a the deed breakdown counts the new listings',
    (after.stats.deedTypes.turkish ?? 0) === beforeTurkish + 3,
    `${beforeTurkish} → ${after.stats.deedTypes.turkish}`,
  );
  ok(
    '5b the breakdown totals the listing count',
    Object.values(after.stats.deedTypes).reduce((a, b) => a + b, 0) === after.stats.total,
    JSON.stringify(after.stats.deedTypes),
  );

  // ── 6. unknown slug ──────────────────────────────────────────────
  ok('6a an unknown region 404s', (await expectFail('GET', '/regions/atlantis')) === 404);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL REGION-PAGE E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
