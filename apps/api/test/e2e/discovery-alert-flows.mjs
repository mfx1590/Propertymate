/**
 * Self-contained integration test for the §6.1 discovery alerts:
 *   1. a price change on a live listing is recorded as history — but only a
 *      real movement: first-time pricing and a no-op re-save are not changes
 *   2. saved-search alerts fire for listings that appeared AFTER the search was
 *      saved, never for the back catalogue that already existed
 *   3. the alert cursor advances, so the same matches are not announced twice
 *   4. a favourite whose price drops produces a price-drop alert naming the
 *      percentage, and a rise produces nothing
 *   5. drops below the configured threshold are ignored as noise
 *   6. the sweeps are admin-only
 *
 * Creates every account, listing, saved search and favourite it asserts on.
 * The price-drop threshold is a platform setting, so it is restored in a
 * `finally`. Run against a live API: `npm run test:e2e:alerts`.
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-alerts')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const settingsBefore = await req('GET', '/admin/settings', { token: admin });
  const dropPctBefore = settingsBefore.find((s) => s.key === 'alerts.price_drop_min_pct')?.value ?? null;

  try {
    await req('PUT', '/admin/settings/alerts.price_drop_min_pct', { token: admin, body: { value: 1 } });

    const u = `${Date.now()}`.slice(-7);
    const landlordPhone = `+9053${u}1`;
    const buyerPhone = `+9053${u}2`;

    const landlord = await otp(landlordPhone, 'owner');
    await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: landlordPhone, planKey: 'owner_basic', months: 12 } });
    const buyer = await otp(buyerPhone, 'customer');

    // Rentals go live on approval without needing an agent mandate (§13.4),
    // which keeps this suite about alerts rather than about assignments.
    async function liveRental(title, price) {
      const p = await req('POST', '/properties', { token: landlord, body: { kind: 'rental' } });
      await req('PUT', `/properties/${p.id}`, {
        token: landlord,
        body: {
          title,
          description: 'Listing used to exercise the §6.1 discovery alert sweeps.',
          regionSlug: 'lefke', lat: 35.11, lng: 32.84,
          priceAmount: price, priceCurrency: 'GBP', bedrooms: 2, bathrooms: 1, areaM2: 90,
          deedType: 'turkish', furnished: true,
        },
      });
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
      return p;
    }

    // ── 0. an existing listing, live BEFORE the search is saved ────
    const older = await liveRental(`Alert older ${u}`, 1000);
    await retry(
      () => req('GET', `/search/listings?region=lefke&q=${u}`),
      (r) => (r.hits ?? []).some((h) => h.id === older.id),
    );

    // ── 1. price history records real movements only ───────────────
    // A no-op re-save must not manufacture history.
    await req('PUT', `/properties/${older.id}`, { token: landlord, body: { priceAmount: 1000 } });
    let detail = await req('GET', `/properties/${older.id}`);
    ok('1a re-saving the same price records no change', (detail.priceChanges ?? []).length === 0, JSON.stringify(detail.priceChanges ?? []));

    await req('PUT', `/properties/${older.id}`, { token: landlord, body: { priceAmount: 900 } });
    detail = await req('GET', `/properties/${older.id}`);
    const hist = detail.priceChanges ?? [];
    ok('1b a real reduction is recorded', hist.length === 1, `${hist.length} rows`);
    ok('1c the percentage is signed and correct', Number(hist[0]?.changePct) === -10, `${hist[0]?.changePct}`);
    ok('1d the listing exposes a reduced flag', detail.priceReducedPct === 10, `${detail.priceReducedPct}`);

    // §13.5 boundary: a price-change row's absolute amounts are the OWNER's
    // ask. On a mediated resale that is not the public price, so publishing it
    // would expose the agent's margin. The public gets percentages only.
    ok(
      '1e the public history carries no absolute amounts',
      hist.every((c) => c.oldBaseGbp === undefined && c.newBaseGbp === undefined),
      JSON.stringify(hist[0]),
    );
    const ownerView = await req('GET', `/properties/${older.id}`, { token: landlord });
    const ownerHist = ownerView.priceChanges ?? [];
    ok(
      '1f the owner still sees both sides of their own price change',
      Number(ownerHist[0]?.oldBaseGbp) === 1000 && Number(ownerHist[0]?.newBaseGbp) === 900,
      JSON.stringify(ownerHist[0]),
    );

    // ── 2. saved search only alerts on what is NEW ─────────────────
    const saved = await req('POST', '/users/me/saved-searches', {
      token: buyer,
      body: { name: `Lefke ${u}`, query: { region: 'lefke', q: `${u}` } },
    });
    ok('2a the search saved', !!saved.id);

    // Nothing has appeared since it was saved, so the first sweep is silent.
    const firstSweep = await req('POST', '/admin/jobs/saved-search-alerts', { token: admin });
    ok('2b the sweep ran', typeof firstSweep.checked === 'number', JSON.stringify(firstSweep));
    let notes = await req('GET', '/users/me/notifications', { token: buyer });
    ok(
      '2c an existing listing is not announced as new',
      notes.filter((n) => n.templateKey === 'discovery.new_matches').length === 0,
      `${notes.length} notifications`,
    );

    // Now publish one AFTER the search was saved.
    const fresh = await liveRental(`Alert fresh ${u}`, 1200);
    await retry(
      () => req('GET', `/search/listings?region=lefke&q=${u}`),
      (r) => (r.hits ?? []).some((h) => h.id === fresh.id),
    );

    await req('POST', '/admin/jobs/saved-search-alerts', { token: admin });
    notes = await retry(
      () => req('GET', '/users/me/notifications', { token: buyer }),
      (n) => n.some((x) => x.templateKey === 'discovery.new_matches'),
    );
    const matchNote = notes.find((n) => n.templateKey === 'discovery.new_matches');
    ok('2d a listing published after saving does alert', !!matchNote, `${notes.length} notifications`);
    // An in-app row stores templateKey + payload; the rendered sentence is the
    // client's job (next-intl on web, the local catalogue on mobile). The
    // payload is the contract, so that is what this asserts.
    ok('2e the alert payload names the saved search', matchNote?.payload?.name === `Lefke ${u}`, JSON.stringify(matchNote?.payload));
    ok('2f and counts only the new one', matchNote?.payload?.count === 1, JSON.stringify(matchNote?.payload));

    // ── 3. the cursor advances ─────────────────────────────────────
    await req('POST', '/admin/jobs/saved-search-alerts', { token: admin });
    notes = await req('GET', '/users/me/notifications', { token: buyer });
    ok(
      '3a a second sweep does not repeat the same matches',
      notes.filter((n) => n.templateKey === 'discovery.new_matches').length === 1,
      `${notes.filter((n) => n.templateKey === 'discovery.new_matches').length} alerts`,
    );

    // ── 4. price drops on favourites ───────────────────────────────
    await req('POST', `/properties/${fresh.id}/favorite`, { token: buyer });

    // A rise is not a drop.
    await req('PUT', `/properties/${fresh.id}`, { token: landlord, body: { priceAmount: 1300 } });
    await req('POST', '/admin/jobs/price-drop-alerts', { token: admin });
    notes = await req('GET', '/users/me/notifications', { token: buyer });
    ok(
      '4a a price rise produces no alert',
      notes.filter((n) => n.templateKey === 'discovery.price_drop').length === 0,
    );

    await req('PUT', `/properties/${fresh.id}`, { token: landlord, body: { priceAmount: 1100 } });
    const dropSweep = await req('POST', '/admin/jobs/price-drop-alerts', { token: admin });
    ok('4b the drop sweep alerted', dropSweep.alerted >= 1, JSON.stringify(dropSweep));
    notes = await retry(
      () => req('GET', '/users/me/notifications', { token: buyer }),
      (n) => n.some((x) => x.templateKey === 'discovery.price_drop'),
    );
    const dropNote = notes.find((n) => n.templateKey === 'discovery.price_drop');
    ok('4c the favouriter is told', !!dropNote, `${notes.length} notifications`);
    // 1300 -> 1100 is -15.4%, measured across the whole window since the last
    // sweep rather than from the price when it was favourited.
    ok('4d the payload states the drop percentage', dropNote?.payload?.pct === 15.4, JSON.stringify(dropNote?.payload));
    ok('4e and names the property', dropNote?.payload?.title === `Alert fresh ${u}`, JSON.stringify(dropNote?.payload));

    await req('POST', '/admin/jobs/price-drop-alerts', { token: admin });
    notes = await req('GET', '/users/me/notifications', { token: buyer });
    ok(
      '4f the drop is not re-announced on the next sweep',
      notes.filter((n) => n.templateKey === 'discovery.price_drop').length === 1,
    );

    // ── 5. sub-threshold drops are noise, not news ─────────────────
    await req('PUT', '/admin/settings/alerts.price_drop_min_pct', { token: admin, body: { value: 10 } });
    await req('PUT', `/properties/${fresh.id}`, { token: landlord, body: { priceAmount: 1080 } }); // -1.8%
    await req('POST', '/admin/jobs/price-drop-alerts', { token: admin });
    notes = await req('GET', '/users/me/notifications', { token: buyer });
    ok(
      '5a a drop under the configured threshold is ignored',
      notes.filter((n) => n.templateKey === 'discovery.price_drop').length === 1,
      `${notes.filter((n) => n.templateKey === 'discovery.price_drop').length} alerts`,
    );
    // ...but it is still recorded as history, which is what the badge reads.
    detail = await req('GET', `/properties/${fresh.id}`);
    ok('5b the sub-threshold move is still in history', (detail.priceChanges ?? []).length === 3, `${(detail.priceChanges ?? []).length} rows`);

    // ── 6. the sweeps are admin-only ───────────────────────────────
    ok('6a saved-search sweep is admin-only', (await expectFail('POST', '/admin/jobs/saved-search-alerts', { token: buyer })) === 403);
    ok('6b price-drop sweep is admin-only', (await expectFail('POST', '/admin/jobs/price-drop-alerts', { token: buyer })) === 403);
    ok('6c and not public', (await expectFail('POST', '/admin/jobs/price-drop-alerts')) === 401);
  } finally {
    if (dropPctBefore === null) {
      await req('PUT', '/admin/settings/alerts.price_drop_min_pct', { token: admin, body: { value: 1 } }).catch(() => undefined);
    } else {
      await req('PUT', '/admin/settings/alerts.price_drop_min_pct', { token: admin, body: { value: dropPctBefore } }).catch(() => undefined);
    }
  }

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL DISCOVERY-ALERT E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
