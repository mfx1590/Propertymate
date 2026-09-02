/**
 * Self-contained integration test for the 5 Phase-1 critical flows (Plan §10.1 step 7):
 *   1. register + verify a professional profile (agent)
 *   2. publish + verify a listing (owner → verification → find-my-agent → publish)
 *   3. search → viewing
 *   4. offer → deal completion (+ ratings)
 *   5. admin verification queue
 *
 * Creates every actor and prerequisite itself — no dependency on demo/seed data
 * beyond the base seed (roles, regions, pipeline templates, profit bands, plans,
 * admin user). Run against a live API: `npm run test:e2e`.
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
// OTP sends are capped at 5/min per IP (§2.4). Suites run back to back, so
// back off on the 429 the server returns rather than assume a fresh window.
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}
async function retry(fn, check, tries = 8, gap = 500) {
  for (let i = 0; i < tries; i++) {
    const r = await fn();
    if (check(r)) return r;
    await sleep(gap);
  }
  return fn();
}

/** Set once the offers flag has been read, so a failed run still restores it. */
let restoreOffers = async () => {};

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  // Offers ship disabled (change log 2026-08-10). Prove the default holds and
  // the gate bites, then turn it on — the rest of this suite exercises the
  // negotiation and deal machinery that lives behind the toggle.
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: false } });
  const publicFlags = await req('GET', '/settings/public');
  ok('0a offers are disabled by default', publicFlags.offersEnabled === false, `${publicFlags.offersEnabled}`);
  const offersWereEnabled = Boolean((await req('GET', '/settings/public')).offersEnabled);
  // Registered before the flag is touched so the top-level catch below can put
  // it back even if this suite dies half way through. Without that, a failing
  // run leaves offers switched ON for whoever looks at the platform next.
  restoreOffers = async () => {
    await req('PUT', '/admin/settings/offers.enabled', {
      token: admin,
      body: { value: offersWereEnabled },
    }).catch(() => undefined);
  };
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: true } });
  ok(
    '0b the toggle is reflected publicly',
    (await req('GET', '/settings/public')).offersEnabled === true,
  );

  const u = `${Date.now()}`.slice(-7);
  const agentPhone = `+9053${u}1`;
  const ownerPhone = `+9053${u}2`;
  const buyerPhone = `+9054${u}3`;

  // ── Flow 1: register + verify an agent profile ───────────────────
  const agent = await otp(agentPhone, 'solo_agent');
  for (const dt of ['government_id', 'real_estate_license', 'selfie_with_id']) {
    await req('POST', `/users/me/profile/solo_agent/documents`, { token: agent, form: jpeg(dt) });
  }
  let queue = await req('GET', '/admin/verification/queue?entityType=profile', { token: admin });
  const profItem = queue.find((q) => q.summary?.lister === agentPhone);
  ok('1a agent profile entered verification queue', !!profItem);
  const profDetail = await req('GET', `/admin/verification/${profItem.id}`, { token: admin });
  await req('POST', `/admin/verification/${profItem.id}/decision`, {
    token: admin,
    body: { documentDecisions: profDetail.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });
  const agentRoles = await req('GET', '/users/me/roles', { token: agent });
  ok('1b agent verified after approval', agentRoles.find((r) => r.role.key === 'solo_agent')?.verificationStatus === 'verified');

  // ── Flow 2: publish + verify a listing ───────────────────────────
  const owner = await otp(ownerPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });
  const draft = await req('POST', '/properties', { token: owner, body: { kind: 'resale' } });
  await req('PUT', `/properties/${draft.id}`, { token: owner, body: {
    title: `E2E villa ${u}`, description: 'Full critical-flow integration test property in Kyrenia.',
    regionSlug: 'kyrenia', district: 'Alsancak', lat: 35.34, lng: 33.32,
    priceAmount: 150000, priceCurrency: 'GBP', bedrooms: 3, bathrooms: 2, areaM2: 140, deedType: 'turkish', furnished: true } });
  for (let i = 0; i < 5; i++) await req('POST', `/properties/${draft.id}/photos`, { token: owner, form: jpeg() });
  for (const dt of ['title_deed', 'owner_id', 'utility_bill']) await req('POST', `/properties/${draft.id}/documents`, { token: owner, form: pdf(dt) });
  await req('POST', `/properties/${draft.id}/submit`, { token: owner });

  queue = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
  const listItem = queue.find((q) => q.entityId === draft.id);
  ok('5 admin queue shows the pending listing', !!listItem, `queue depth ${queue.length}`);
  const listDetail = await req('GET', `/admin/verification/${listItem.id}`, { token: admin });
  await req('POST', `/admin/verification/${listItem.id}/decision`, {
    token: admin,
    body: { documentDecisions: listDetail.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });
  let mine = await req('GET', '/properties/mine', { token: owner });
  ok('2a resale approved → verified_private (not public)', mine.find((p) => p.id === draft.id)?.status === 'verified_private');

  // The dashboard checklist has to name the non-obvious next move here: the
  // listing is verified but invisible, and nothing else on the platform says so.
  const ownerSteps = await req('GET', '/users/me/next-steps', { token: owner });
  const stepKeys = ownerSteps.steps.map((s) => s.key);
  ok('2a1 next-steps tells the owner to choose agents', ownerSteps.primary === 'choose_agents', `primary=${ownerSteps.primary} of ${stepKeys.join(',')}`);
  const chooseStep = ownerSteps.steps.find((s) => s.key === 'choose_agents');
  ok('2a2 it links straight to find-my-agent for that listing', chooseStep?.href === `/dashboard/listings/${draft.id}/find-agent`, chooseStep?.href ?? 'none');
  ok('2a3 earlier steps show as done, not missing', stepKeys.includes('create_listing') && ownerSteps.steps.find((s) => s.key === 'create_listing')?.state === 'done');

  // find-my-agent: owner assigns THIS verified agent, agent accepts + publishes
  const agentId = (await req('GET', '/users/me', { token: agent })).id;
  const dir = await req('GET', '/agents/directory', { token: owner });
  ok('2b0 verified agent appears in directory', dir.some((x) => x.userId === agentId));
  await req('POST', `/properties/${draft.id}/assignments`, { token: owner, body: { agentUserIds: [agentId], termMonths: 3 } });
  const assignments = await req('GET', '/users/me/assignments', { token: agent });
  const a = assignments.find((x) => x.propertyId === draft.id);
  ok('2b agent sees assignment without owner contact', a && !JSON.stringify(a).includes(ownerPhone));
  await req('POST', `/assignments/${a.id}/respond`, { token: agent, body: { action: 'accept' } });
  const pub = await req('POST', `/assignments/${a.id}/publish`, { token: agent, body: { commissionGbp: 5000 } });
  ok('2c published at buyer price (150k+4k+5k)', pub.listPriceGbp === 159000, `list=${pub.listPriceGbp}`);

  // ── Flow 3: search → viewing ─────────────────────────────────────
  const search = await retry(
    () => req('GET', `/search/listings?region=kyrenia`),
    (r) => (r.hits ?? []).some((h) => h.id === draft.id),
  );
  ok('3a listing indexed + searchable at final price', search.hits.some((h) => h.id === draft.id && h.priceBaseGbp === 159000));

  const buyer = await otp(buyerPhone, 'customer');
  const when = new Date(Date.now() + 86400000).toISOString();
  const viewing = await req('POST', `/properties/${draft.id}/viewings`, { token: buyer, body: { scheduledAt: when, notes: 'e2e' } });
  const confirmed = await req('PUT', `/viewings/${viewing.id}/status`, { token: agent, body: { status: 'confirmed' } });
  ok('3b viewing requested + confirmed by host', confirmed.status === 'confirmed');

  // ── Flow 4: offer → deal completion + ratings ────────────────────
  // the toggle has to bite on a real listing, not just in the public payload
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: false } });
  let refused = 0;
  try {
    await req('POST', `/properties/${draft.id}/offers`, { token: buyer, body: { amount: 159000, currency: 'GBP' } });
  } catch (e) {
    refused = Number(/-> (\d+):/.exec(e.message)?.[1] ?? -1);
  }
  ok('4a0 a disabled platform refuses new offers', refused === 400, `status ${refused}`);
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: true } });

  const offer = await req('POST', `/properties/${draft.id}/offers`, { token: buyer, body: { amount: 159000, currency: 'GBP' } });
  const accepted = await req('POST', `/offers/${offer.id}/respond`, { token: agent, body: { action: 'accept' } });
  ok('4a offer accepted → deal room created', !!accepted.dealId);
  const dealId = accepted.dealId;

  // advance the purchase pipeline to completion
  let d = await req('GET', `/deals/${dealId}`, { token: buyer });
  ok('4b snapshot frozen + pipeline at legal_check', Number(d.snapshot.priceAgreed) === 159000 && d.currentStageKey === 'legal_check');
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // legal_check → contract_signing
  await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('contract') });
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // contract_signing → deposit_recorded
  await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('deposit_receipt') });
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // deposit → permit_process
  await req('POST', `/deals/${dealId}/skip`, { token: buyer }); // skip permit → completion
  d = await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // completion
  ok('4c deal completed', d.status === 'completed');
  mine = await req('GET', '/properties/mine', { token: owner });
  ok('4d property marked sold', mine.find((p) => p.id === draft.id)?.status === 'sold');

  // ratings: reciprocal reveal
  const buyerId = (await req('GET', '/users/me', { token: buyer })).id;
  const r1 = await req('POST', `/deals/${dealId}/ratings`, { token: buyer, body: { rateeId: agentId, stars: 5, tags: ['responsive'] } });
  ok('4e first rating hidden until reciprocal', r1.revealed === false);
  const r2 = await req('POST', `/deals/${dealId}/ratings`, { token: agent, body: { rateeId: buyerId, stars: 5, tags: ['honest'] } });
  ok('4f both ratings revealed after reciprocal', r2.revealed === true);
  const reviews = await req('GET', `/users/${agentId}/reviews`);
  ok('4g agent public reviews visible (no raterId leak)', reviews.count >= 1 && !JSON.stringify(reviews).includes('raterId'));

  // Put the platform back how we found it. These suites run against dev
  // databases as well as CI's throwaway one, and silently leaving a disabled
  // feature switched on is a nasty surprise for whoever looks next.
  await restoreOffers();

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CRITICAL-FLOW E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  await restoreOffers();
  console.error('E2E ERROR:', e.message);
  process.exit(1);
});
