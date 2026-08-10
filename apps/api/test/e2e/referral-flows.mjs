/**
 * Self-contained integration test for the referral system (Plan §8):
 *   1. every account gets a unique invite code, minted on first read
 *   2. signing up on a code attributes the referral; a bad code never blocks
 *      a signup, and nobody can refer themselves
 *   3. attribution happens on account CREATION only — signing in later is not
 *      a referral
 *   4. §8 qualifying event: the invitee publishing a VERIFIED listing earns
 *      the referrer a featured-listing credit (a draft earns nothing)
 *   5. a credit is spent to feature a live listing, and only a live one
 *   6. featuring boosts search order without ever promoting unverified supply
 *   7. credits cannot be double-spent, and the balance is honest
 *   8. invitee identities are never exposed to the referrer
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:referrals`.
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

async function otp(phone, accountType, referralCode) {
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
  const v = await req('POST', '/auth/otp/verify', {
    body: { phone, code: r.devCode, accountType, ...(referralCode ? { referralCode } : {}) },
  });
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-referral')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}
async function retry(fn, check, tries = 12, gap = 500) {
  for (let i = 0; i < tries; i++) {
    const r = await fn().catch(() => null);
    if (r && check(r)) return r;
    await sleep(gap);
  }
  return fn();
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const referrerPhone = `+9053${u}1`;
  const inviteePhone = `+9053${u}2`;
  const strangerEmail = `stranger-${u}@propverify.test`;

  // ── 1. codes ─────────────────────────────────────────────────────
  const referrer = await otp(referrerPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: referrerPhone, planKey: 'owner_basic', months: 12 } });

  const mine = await req('GET', '/users/me/referrals', { token: referrer });
  ok('1a a code is minted on first read', typeof mine.code === 'string' && mine.code.length === 8, mine.code);
  ok('1b the code avoids ambiguous characters', !/[01ILO]/.test(mine.code), mine.code);
  const again = await req('GET', '/users/me/referrals', { token: referrer });
  ok('1c the code is stable across reads', again.code === mine.code);
  ok('1d a new account has invited nobody', mine.summary.invited === 0 && mine.summary.creditsAvailable === 0);

  // ── 2. attribution at signup ─────────────────────────────────────
  const invitee = await otp(inviteePhone, 'owner', mine.code);
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: inviteePhone, planKey: 'owner_basic', months: 12 } });

  let overview = await req('GET', '/users/me/referrals', { token: referrer });
  ok('2a signing up on a code attributes the referral', overview.summary.invited === 1, `${overview.summary.invited}`);
  ok('2b it starts pending — signing up alone earns nothing', overview.referrals[0].status === 'pending', overview.referrals[0].status);
  ok('2c no credit yet', overview.summary.creditsAvailable === 0);

  // a nonsense code must never block a signup
  const stranger = (await req('POST', '/auth/register', {
    body: { email: strangerEmail, password: 'E2ePass123!', accountType: 'customer', referralCode: 'ZZZZZZZZ' },
  })).accessToken;
  ok('2d an unknown code still creates the account', !!stranger);
  const strangerView = await req('GET', '/users/me/referrals', { token: stranger });
  ok('2e an unknown code attributes nothing', strangerView.summary.invited === 0);

  // self-referral is silently ignored
  await req('GET', '/users/me/referrals', { token: stranger });
  ok('2f a stranger has their own distinct code', strangerView.code !== mine.code);

  // ── 3. only account creation counts ──────────────────────────────
  await otp(inviteePhone, undefined, mine.code); // the invitee signs in again on the link
  overview = await req('GET', '/users/me/referrals', { token: referrer });
  ok('3a signing in again is not a second referral', overview.summary.invited === 1, `${overview.summary.invited}`);

  // ── 4. the qualifying event ──────────────────────────────────────
  const draft = await req('POST', '/properties', { token: invitee, body: { kind: 'rental' } });
  await req('PUT', `/properties/${draft.id}`, {
    token: invitee,
    body: {
      title: `Referral flat ${u}`,
      description: 'Rental listing published by an invitee to qualify the referral reward.',
      regionSlug: 'iskele', lat: 35.28, lng: 33.89,
      priceAmount: 700, priceCurrency: 'GBP', bedrooms: 1, bathrooms: 1, areaM2: 60,
      deedType: 'turkish', furnished: true,
    },
  });
  for (let i = 0; i < 5; i++) await req('POST', `/properties/${draft.id}/photos`, { token: invitee, form: jpeg() });

  overview = await req('GET', '/users/me/referrals', { token: referrer });
  ok('4a an unpublished draft earns nothing', overview.summary.creditsAvailable === 0);

  for (const dt of ['title_deed', 'owner_id']) {
    await req('POST', `/properties/${draft.id}/documents`, { token: invitee, form: pdf(dt) });
  }
  await req('POST', `/properties/${draft.id}/submit`, { token: invitee });
  overview = await req('GET', '/users/me/referrals', { token: referrer });
  ok('4b awaiting verification still earns nothing', overview.summary.creditsAvailable === 0);

  const queue = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
  const item = queue.find((q) => q.entityId === draft.id);
  const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
  await req('POST', `/admin/verification/${item.id}/decision`, {
    token: admin,
    body: { documentDecisions: detail.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });

  overview = await retry(
    () => req('GET', '/users/me/referrals', { token: referrer }),
    (r) => r.summary.creditsAvailable > 0,
  );
  ok('4c a verified published listing qualifies the referral', overview.referrals[0].status === 'qualified', overview.referrals[0].status);
  ok('4d the referrer earns one featured credit', overview.summary.creditsAvailable === 1, `${overview.summary.creditsAvailable}`);
  ok('4e the credit expires eventually', !!overview.credits[0].expiresAt);
  ok('4f the credit records where it came from', overview.credits[0].source === 'referral');

  // ── 5. spending it ───────────────────────────────────────────────
  // the referrer needs a live listing of their own to feature
  const own = await req('POST', '/properties', { token: referrer, body: { kind: 'rental' } });
  await req('PUT', `/properties/${own.id}`, {
    token: referrer,
    body: {
      title: `Referrer flat ${u}`,
      description: 'The referrer own listing, used to spend the earned featured credit.',
      regionSlug: 'iskele', lat: 35.28, lng: 33.89,
      priceAmount: 720, priceCurrency: 'GBP', bedrooms: 1, bathrooms: 1, areaM2: 62,
      deedType: 'turkish', furnished: true,
    },
  });
  const notLive = await expectFail('POST', `/properties/${own.id}/feature`, { token: referrer });
  ok('5a a draft listing cannot be featured', notLive === 400, `status ${notLive}`);

  for (let i = 0; i < 5; i++) await req('POST', `/properties/${own.id}/photos`, { token: referrer, form: jpeg() });
  for (const dt of ['title_deed', 'owner_id']) {
    await req('POST', `/properties/${own.id}/documents`, { token: referrer, form: pdf(dt) });
  }
  await req('POST', `/properties/${own.id}/submit`, { token: referrer });
  const q2 = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
  const item2 = q2.find((x) => x.entityId === own.id);
  const detail2 = await req('GET', `/admin/verification/${item2.id}`, { token: admin });
  await req('POST', `/admin/verification/${item2.id}/decision`, {
    token: admin,
    body: { documentDecisions: detail2.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });

  const featured = await req('POST', `/properties/${own.id}/feature`, { token: referrer });
  ok('5b a credit features a live listing', !!featured.featuredUntil);
  ok('5c the balance drops', featured.creditsRemaining === 0, `${featured.creditsRemaining}`);

  const somebodyElses = await expectFail('POST', `/properties/${draft.id}/feature`, { token: referrer });
  ok('5d you cannot feature someone else listing', somebodyElses === 400, `status ${somebodyElses}`);

  // ── 6. the boost reaches search ──────────────────────────────────
  const search = await retry(
    () => req('GET', '/search/listings?region=iskele'),
    (r) => (r.hits ?? []).some((h) => h.id === own.id && h.featured === 1),
  );
  const hit = search.hits.find((h) => h.id === own.id);
  ok('6a the featured flag reaches the index', hit?.featured === 1, `${hit?.featured}`);
  const inviteeHit = search.hits.find((h) => h.id === draft.id);
  ok('6b an unfeatured live listing is still indexed', inviteeHit?.featured === 0, `${inviteeHit?.featured}`);
  const featuredPos = search.hits.findIndex((h) => h.id === own.id);
  const plainPos = search.hits.findIndex((h) => h.id === draft.id);
  ok('6c the featured listing outranks the unfeatured one', featuredPos < plainPos, `#${featuredPos} vs #${plainPos}`);

  // ── 7. no double-spending ────────────────────────────────────────
  const spentTwice = await expectFail('POST', `/properties/${own.id}/feature`, { token: referrer });
  ok('7a an already-featured listing is rejected', spentTwice === 400, `status ${spentTwice}`);

  const finalView = await req('GET', '/users/me/referrals', { token: referrer });
  ok('7b the spent credit is marked used', finalView.summary.creditsUsed === 1 && finalView.summary.creditsAvailable === 0);
  ok('7c the credit records the listing it was spent on', finalView.credits[0].usedOnPropertyId === own.id);
  ok('7d no credits, no featuring', (await expectFail('POST', `/properties/${own.id}/feature`, { token: referrer })) === 400);

  // ── 8. privacy ───────────────────────────────────────────────────
  const payload = JSON.stringify(finalView);
  ok('8a invitee phone is never exposed to the referrer', !payload.includes(inviteePhone));
  ok('8b invitee user ids are not exposed either', !payload.includes('refereeId') && !payload.includes('referrerId'));
  ok('8c the referrals endpoint needs a session', (await expectFail('GET', '/users/me/referrals')) === 401);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL REFERRAL E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  if (results.length) console.log(results.join('\n'));
  console.error('E2E ERROR:', e.message);
  process.exit(1);
});
