/**
 * Self-contained integration test for recommendation v1 (Plan §8):
 *   1. view attribution — a session key groups signed-out views, and one
 *      visit is one view (the SSR page fetches twice; a refresh is not demand)
 *   2. co-visitation — two listings seen by the same sessions recommend
 *      each other after the nightly rebuild
 *   3. scoring is cosine, not raw counts, so a popular listing does not
 *      get recommended everywhere purely for being popular
 *   4. a listing with no view history falls back to comparables rather than
 *      showing an empty strip
 *   5. only live listings are recommended — a sold one is a dead end
 *   6. the public payload never leaks the §13.5 price breakdown
 *   7. the rebuild endpoint is admin-only; reading similar listings is public
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:recommendations`.
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
function jpeg(documentType) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(JPEG_B64, 'base64')], { type: 'image/jpeg' }), 'x.jpg');
  if (documentType) fd.append('documentType', documentType);
  return fd;
}
function pdf(documentType) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-recs')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const ownerPhone = `+9053${u}1`;

  const owner = await otp(ownerPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });

  /** Publishes a live rental listing (rentals go public straight after approval). */
  async function publish(label, price, bedrooms) {
    const p = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
    await req('PUT', `/properties/${p.id}`, {
      token: owner,
      body: {
        title: `Rec ${label} ${u}`,
        description: `Listing ${label} used to exercise the co-visitation recommender.`,
        regionSlug: 'famagusta', lat: 35.12, lng: 33.94,
        priceAmount: price, priceCurrency: 'GBP', bedrooms, bathrooms: 1, areaM2: 80 + bedrooms * 10,
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

  const a = await publish('A', 900, 2);
  const b = await publish('B', 950, 2);
  const popular = await publish('POP', 1000, 2);
  const lonely = await publish('LONELY', 1200, 3);

  // ── 1. view attribution ──────────────────────────────────────────
  // read the counter through the owner's own listing board: the public detail
  // endpoint records a view, so reading it there would measure the probe itself
  const viewsOf = async (id, expected) => {
    for (let i = 0; i < 10; i++) {
      const mine = await req('GET', '/properties/mine', { token: owner });
      const count = mine.find((p) => p.id === id)?.viewCount ?? 0;
      if (expected === undefined || count === expected) return count;
      await sleep(300); // the view write is fire-and-forget
    }
    const mine = await req('GET', '/properties/mine', { token: owner });
    return mine.find((p) => p.id === id)?.viewCount ?? 0;
  };

  ok('1a a listing starts with no views', (await viewsOf(a)) === 0);

  // the SSR page fetches twice per visit (metadata + page) — one visit is one view
  for (let i = 0; i < 3; i++) await req('GET', `/properties/${a}`, { sessionKey: `${u}-dedupe` });
  ok('1b repeat fetches from one session count once', (await viewsOf(a, 1)) === 1, `${await viewsOf(a)}`);

  await req('GET', `/properties/${a}`, { sessionKey: `${u}-other` });
  ok('1c a different session is a different view', (await viewsOf(a, 2)) === 2, `${await viewsOf(a)}`);

  // the lister's own visits are not demand (§6.7)
  await req('GET', `/properties/${a}`, { token: owner, sessionKey: `${u}-owner` });
  ok('1d the owner viewing their own listing is not counted', (await viewsOf(a)) === 2, `${await viewsOf(a)}`);

  // ── 2–3. co-visitation ───────────────────────────────────────────
  // three sessions see A and B; the "popular" listing is seen by everyone but
  // shares no session-pair advantage, so cosine should not let it dominate
  for (const s of ['s1', 's2', 's3']) {
    await req('GET', `/properties/${a}`, { sessionKey: `${u}-${s}` });
    await req('GET', `/properties/${b}`, { sessionKey: `${u}-${s}` });
  }
  for (const s of ['s4', 's5', 's6', 's7', 's8']) {
    await req('GET', `/properties/${popular}`, { sessionKey: `${u}-${s}` });
  }
  // two of the A/B viewers also glanced at the popular one
  await req('GET', `/properties/${popular}`, { sessionKey: `${u}-s1` });
  await req('GET', `/properties/${popular}`, { sessionKey: `${u}-s2` });

  const rebuilt = await req('POST', '/search/recommendations/rebuild', { token: admin });
  ok('2a rebuild reports what it wrote', typeof rebuilt.pairs === 'number' && rebuilt.pairs > 0, JSON.stringify(rebuilt));

  const forA = await req('GET', `/search/similar/${a}`);
  ok('2b recommendations come from co-visitation', forA.source === 'co_visitation', forA.source);
  ok('2c the co-viewed listing is recommended', forA.items.some((i) => i.id === b), forA.items.map((i) => i.id).join(','));
  ok('2d a listing never recommends itself', !forA.items.some((i) => i.id === a));

  const topForA = forA.items[0];
  ok('3a the strongest co-visit ranks first', topForA.id === b, `${topForA.id}`);
  const popEntry = forA.items.find((i) => i.id === popular);
  ok(
    '3b cosine keeps the merely-popular listing below the true pair',
    !popEntry || popEntry.score < topForA.score,
    `pop=${popEntry?.score} vs top=${topForA.score}`,
  );
  ok('3c the co-view count is auditable alongside the score', typeof topForA.coViews === 'number' && topForA.coViews >= 2, `${topForA.coViews}`);

  // ── 4. fallback for a listing nobody has browsed with others ─────
  const forLonely = await req('GET', `/search/similar/${lonely}`);
  ok('4a an unbrowsed listing falls back to comparables', forLonely.source === 'similar_listing', forLonely.source);
  ok('4b the fallback is not empty', forLonely.items.length > 0, `${forLonely.items.length}`);
  ok('4c the fallback excludes the listing itself', !forLonely.items.some((i) => i.id === lonely));
  ok('4d the fallback carries no co-visit score', forLonely.items.every((i) => i.score === undefined));

  // ── 5. only live listings are recommended ────────────────────────
  // an unpublished draft matching the fallback criteria exactly: same kind,
  // region and bedroom count as `lonely`, so only the status filter excludes it
  const draft = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
  await req('PUT', `/properties/${draft.id}`, {
    token: owner,
    body: {
      title: `Rec DRAFT ${u}`,
      description: 'Never submitted — must never surface as a recommendation.',
      regionSlug: 'famagusta', lat: 35.12, lng: 33.94,
      priceAmount: 1200, priceCurrency: 'GBP', bedrooms: 3, bathrooms: 1, areaM2: 110,
      deedType: 'turkish', furnished: true,
    },
  });
  const afterDraft = await req('GET', `/search/similar/${lonely}`);
  ok(
    '5a a draft listing is never recommended',
    !afterDraft.items.some((i) => i.id === draft.id),
    afterDraft.items.map((i) => i.id).join(','),
  );
  ok('5b the live comparables are still returned', afterDraft.items.length > 0, `${afterDraft.items.length}`);

  // ── 6. payload hygiene ───────────────────────────────────────────
  const payload = JSON.stringify(forA);
  ok('6a no §13.5 profit breakdown in the payload', !payload.includes('platformProfit') && !payload.includes('agentCommission'));
  ok('6b no internal owner ids in the payload', !payload.includes('createdByUserId') && !payload.includes('publishedByAgentId'));

  // ── 7. access control ────────────────────────────────────────────
  ok('7a similar listings are public', (await req('GET', `/search/similar/${a}`)).items.length >= 0);
  ok('7b rebuild is admin-only', (await expectFail('POST', '/search/recommendations/rebuild', { token: owner })) === 403);
  ok('7c rebuild rejects anonymous callers', (await expectFail('POST', '/search/recommendations/rebuild')) === 401);
  const unknown = await req('GET', '/search/similar/does-not-exist');
  ok('7d an unknown listing yields an empty result, not an error', unknown.items.length === 0 && unknown.source === 'none');

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL RECOMMENDATION E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
