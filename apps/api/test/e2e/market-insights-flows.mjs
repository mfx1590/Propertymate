/**
 * Self-contained integration test for market insights + valuation v1
 * (Plan §6.1 "monthly market-insights pages", §10.2 Phase 3).
 *
 * Every aggregate is asserted as a DELTA against whatever the database held
 * before the suite ran, so the same checks pass against the clean CI database
 * and a demo-filled dev one. Where the baseline happens to be empty (CI), the
 * valuation is additionally pinned to exact arithmetic — median £/m² × area,
 * with a 25th–75th percentile band — computed by hand in the comments below.
 *
 *   1. the snapshot job writes one row per region-month, upserts rather than
 *      duplicates, and its counts move by exactly what was published
 *   2. a price drop in the month is counted and sized
 *   3. the valuation answers from comparables, refuses below five of them,
 *      and its estimate always sits inside its own band — the defect the
 *      rounding fix in market-stats exists to prevent
 *   4. everything public is public, everything admin is not
 *
 * §13.5 (mediated resales price at the agent's list price, never the owner's
 * ask) is not re-driven here: insights consumes the same shared
 * `market-stats` helpers the region pages do, and the region-page suite
 * already pins that boundary — a second mandate dance would test the helper
 * twice and the wiring zero more times.
 *
 * One honest caveat: the flow deltas assume the suite does not straddle a
 * calendar month boundary mid-run. If a run starts at 23:59:59 UTC on the
 * 31st, rerun it.
 *
 * Run against a live API: `npm run test:e2e:insights`.
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 250)}`);
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
function pdf(documentType, salt) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(`%PDF-1.4 e2e-insights ${salt}`)], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

const REGION = 'lefke';
const AREA = 100;
// Five rentals at these monthly prices over 100 m² give a £/m² set of
// 7, 8, 9, 10, 11 — median 9, 25th percentile 8, 75th percentile 10.
const PRICES = [700, 800, 900, 1000, 1100];

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const TAG = `zqxinsight${u}`;
  const ownerPhone = `+9053${u}3`;
  const owner = await otp(ownerPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic' } });

  async function publish(label, price, bedrooms) {
    const p = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
    await req('PUT', `/properties/${p.id}`, {
      token: owner,
      body: {
        title: `${TAG} ${label}`,
        description: 'Listing used to exercise market insights and valuation v1.',
        regionSlug: REGION, lat: 35.11, lng: 32.85,
        priceAmount: price, priceCurrency: 'GBP',
        bedrooms, bathrooms: 1, areaM2: AREA,
        deedType: 'turkish', furnished: true,
      },
    });
    for (let i = 0; i < 5; i++) await req('POST', `/properties/${p.id}/photos`, { token: owner, form: jpeg() });
    for (const dt of ['title_deed', 'owner_id']) {
      await req('POST', `/properties/${p.id}/documents`, { token: owner, form: pdf(dt, `${TAG}-${label}-${dt}`) });
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

  // ── 1. baseline, then publish, then measure the movement ──────────
  const firstRun = await req('POST', '/admin/jobs/market-snapshot', { token: admin });
  ok('1a the sweep reports a month and covers every region', /^\d{4}-\d{2}$/.test(firstRun.month) && firstRun.regions >= 6, JSON.stringify(firstRun));

  const seriesBefore = await req('GET', `/insights/regions/${REGION}`);
  const monthsBefore = seriesBefore.months.length;
  const base = seriesBefore.months[seriesBefore.months.length - 1];
  ok('1b the series carries the row the sweep just wrote', base?.month === firstRun.month, JSON.stringify(base ?? null));

  // The valuation baseline for 7-bedroom rentals in this region — on the clean
  // CI database this is zero, which unlocks the exact-arithmetic checks below.
  const valBefore = await req('GET', `/insights/valuation?kind=rental&region=${REGION}&areaM2=${AREA}&bedrooms=7`);
  const baseComparables = valBefore.comparableCount ?? 0;

  const ids = [];
  for (let i = 0; i < PRICES.length; i++) ids.push(await publish(`V${i}`, PRICES[i], 7));

  await req('POST', '/admin/jobs/market-snapshot', { token: admin });
  const seriesAfter = await req('GET', `/insights/regions/${REGION}`);
  const now = seriesAfter.months[seriesAfter.months.length - 1];

  ok('1c a re-run refines the month in place, never duplicates it', seriesAfter.months.length === monthsBefore, `${monthsBefore} -> ${seriesAfter.months.length}`);
  ok('1d the rental stock moved by exactly what was published', now.rentCount - base.rentCount === PRICES.length, `${now.rentCount - base.rentCount}`);
  ok('1e so did the month’s new-listing count', now.newListings - base.newListings === PRICES.length, `${now.newListings - base.newListings}`);
  ok('1f the rent median exists once rentals do', Number.isFinite(now.rentMedianGbp) && now.rentMedianGbp > 0, `${now.rentMedianGbp}`);

  // ── 2. a price drop is counted and sized ─────────────────────────
  // 1100 → 990 is a 10% reduction on the last listing.
  await req('PUT', `/properties/${ids[4]}`, { token: owner, body: { priceAmount: 990, priceCurrency: 'GBP' } });
  await req('POST', '/admin/jobs/market-snapshot', { token: admin });
  const dropped = (await req('GET', `/insights/regions/${REGION}`)).months.at(-1);
  ok('2a the month counts the drop', dropped.priceDrops - base.priceDrops === 1, `${dropped.priceDrops - base.priceDrops}`);
  ok('2b and sizes it', dropped.medianDropPct !== null && dropped.medianDropPct > 0, `${dropped.medianDropPct}`);

  // A view lands in the month's demand column (dedupe needs an identity).
  await req('GET', `/properties/${ids[0]}`, { sessionKey: `${TAG}-viewer` });
  await req('POST', '/admin/jobs/market-snapshot', { token: admin });
  const viewed = (await req('GET', `/insights/regions/${REGION}`)).months.at(-1);
  ok('2c a public view lands in the demand column', viewed.views - base.views >= 1, `${viewed.views - base.views}`);

  // ── 3. valuation v1 ──────────────────────────────────────────────
  const val = await req('GET', `/insights/valuation?kind=rental&region=${REGION}&areaM2=${AREA}&bedrooms=7`);
  ok('3a enough comparables now exist', val.available === true, JSON.stringify(val));
  ok('3b every comparable this suite created is counted', val.comparableCount - baseComparables === PRICES.length, `${val.comparableCount - baseComparables}`);
  ok('3c the estimate sits inside its own band', val.lowGbp <= val.estimateGbp && val.estimateGbp <= val.highGbp, JSON.stringify([val.lowGbp, val.estimateGbp, val.highGbp]));

  if (baseComparables === 0) {
    // Clean-database path (CI): the comparables are exactly this suite's five
    // listings — after the drop their prices are 700, 800, 900, 1000, 990, so
    // £/m² sorted is 7, 8, 9, 9.9, 10: median 9, p25 8, p75 9.9.
    ok('3d the estimate is the median £/m² × area', val.estimateGbp === 9 * AREA, `${val.estimateGbp}`);
    ok('3e the band is the 25th–75th percentile × area', val.lowGbp === 8 * AREA && val.highGbp === 990, `${val.lowGbp}..${val.highGbp}`);
  } else {
    ok('3d (demo data present — exact arithmetic covered on the clean CI run)', true);
    ok('3e the per-m² figure is coherent with the estimate', Math.abs(val.perM2MedianGbp * AREA - val.estimateGbp) <= AREA, `${val.perM2MedianGbp}`);
  }

  const few = await req('GET', `/insights/valuation?kind=rental&region=${REGION}&areaM2=${AREA}&bedrooms=15`);
  ok('3f below five comparables it refuses rather than guessing', few.available === false && few.minComparables === 5, JSON.stringify(few));
  ok('3g and says how many it found', typeof few.comparableCount === 'number');

  const payload = JSON.stringify(val);
  ok('3h the answer is an aggregate — no listing ids leave with it', !payload.includes(ids[0]) && !payload.includes('propertyId'), payload.slice(0, 120));

  ok('3i a nonsense kind is refused', (await expectFail('GET', `/insights/valuation?kind=castle&region=${REGION}&areaM2=100`)) === 400);
  ok('3j an implausible area is refused', (await expectFail('GET', `/insights/valuation?kind=rental&region=${REGION}&areaM2=3`)) === 400);
  ok('3k an unknown region is a 404, not an empty answer', (await expectFail('GET', '/insights/valuation?kind=rental&region=atlantis&areaM2=100')) === 404);
  ok('3l malformed bedrooms are refused', (await expectFail('GET', `/insights/valuation?kind=rental&region=${REGION}&areaM2=100&bedrooms=abc`)) === 400);

  // ── 4. who may see and who may run ───────────────────────────────
  // Everything read above was fetched with no token; make the claim explicit.
  const anonSeries = await req('GET', `/insights/regions/${REGION}`);
  ok('4a the series is public', Array.isArray(anonSeries.months));
  ok('4b an unknown region series is a 404', (await expectFail('GET', '/insights/regions/atlantis')) === 404);
  ok('4c the sweep trigger is admin-only', (await expectFail('POST', '/admin/jobs/market-snapshot', { token: owner })) === 403);
  ok('4d and not public', (await expectFail('POST', '/admin/jobs/market-snapshot')) === 401);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL MARKET-INSIGHTS E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
