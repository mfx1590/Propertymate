/**
 * Self-contained integration test for the lead inbox (Plan §6.2):
 *   1. an inquiry becomes a lead, grouped per listing
 *   2. one prospect on one listing is ONE lead however they engage —
 *      message, viewing and offer collapse into a single row
 *   3. the stage tracks the furthest point the prospect reached
 *   4. response-time tracking: unanswered leads are flagged, answered ones
 *      carry a first-response time that feeds the summary
 *   5. §2.4 contact reveal — identity is hidden until a confirmed viewing,
 *      then appears
 *   6. §13.4 anonymity — on a mediated resale the publishing agent gets the
 *      lead and the OWNER never sees the prospect
 *   7. filters by stage and by listing
 *   8. a customer cannot reach the inbox at all
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:leads`.
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

// OTP sends are capped at 5/min per IP (§2.4); back off on the server's 429.
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-leads')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function approve(admin, findItem, entityType) {
  const queue = await req('GET', `/admin/verification/queue?entityType=${entityType}`, { token: admin });
  const item = queue.find(findItem);
  if (!item) throw new Error(`no ${entityType} item in queue`);
  const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
  const docs = (detail.profile ?? detail.listing ?? detail.project).documents;
  await req('POST', `/admin/verification/${item.id}/decision`, {
    token: admin,
    body: { documentDecisions: docs.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });
}

/** Set once the offers flag has been read, so a failed run still restores it. */
let restoreOffers = async () => {};

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  // Offers ship disabled (change log 2026-08-10); this suite exercises the
  // negotiation and deal machinery behind the toggle, so turn it on first.
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

  const u = `${Date.now()}`.slice(-7);
  const ownerPhone = `+9053${u}1`;
  const buyerPhone = `+9053${u}2`;
  const buyer2Phone = `+9053${u}3`;
  const agentPhone = `+9053${u}4`;

  const owner = await otp(ownerPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });

  // ── a direct rental listing (owner fronts it themselves) ─────────
  const rental = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
  await req('PUT', `/properties/${rental.id}`, {
    token: owner,
    body: {
      title: `Lead flat ${u}`,
      description: 'Rental listing used to exercise the lead inbox aggregation.',
      regionSlug: 'kyrenia', lat: 35.34, lng: 33.32,
      priceAmount: 900, priceCurrency: 'GBP', bedrooms: 2, bathrooms: 1, areaM2: 90,
      deedType: 'turkish', furnished: true,
    },
  });
  for (let i = 0; i < 5; i++) await req('POST', `/properties/${rental.id}/photos`, { token: owner, form: jpeg() });
  for (const dt of ['title_deed', 'owner_id']) {
    await req('POST', `/properties/${rental.id}/documents`, { token: owner, form: pdf(dt) });
  }
  await req('POST', `/properties/${rental.id}/submit`, { token: owner });
  await approve(admin, (q) => q.entityId === rental.id, 'listing');

  const empty = await req('GET', '/leads', { token: owner });
  ok('1a inbox starts empty', empty.leads.length === 0 && empty.summary.total === 0);

  // ── 1–2. one prospect, several kinds of engagement ───────────────
  const buyer = await otp(buyerPhone, 'customer');
  const convo = await req('POST', `/properties/${rental.id}/inquire`, {
    token: buyer,
    body: { message: 'Is this available from next month?' },
  });

  let inbox = await req('GET', '/leads', { token: owner });
  ok('1b an inquiry creates a lead', inbox.leads.length === 1, `${inbox.leads.length}`);
  ok('1c the lead is attributed to the listing', inbox.leads[0].propertyId === rental.id);
  ok('1d listings roll-up counts it', inbox.listings.some((l) => l.propertyId === rental.id && l.leads === 1));
  ok('1e a fresh inquiry is awaiting a reply', inbox.leads[0].awaitingReply === true);
  ok('1f summary counts the unanswered lead', inbox.summary.awaitingReply === 1, `${inbox.summary.awaitingReply}`);
  ok('1g no first-response time until answered', inbox.leads[0].firstResponseSec === null);

  const viewing = await req('POST', `/properties/${rental.id}/viewings`, {
    token: buyer,
    body: { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  await req('POST', `/properties/${rental.id}/offers`, { token: buyer, body: { amount: 850, currency: 'GBP' } });

  inbox = await req('GET', '/leads', { token: owner });
  ok('2a message + viewing + offer stay ONE lead', inbox.leads.length === 1, `${inbox.leads.length}`);
  const lead = inbox.leads[0];
  ok('2b the viewing is attached', lead.viewings.length === 1);
  ok('2c the offer is attached', lead.offers.length === 1 && lead.offers[0].amount === 850);
  ok('3a stage tracks the furthest point reached', lead.stage === 'offer_made', lead.stage);

  // ── 4. response-time tracking ────────────────────────────────────
  await req('POST', `/conversations/${convo.id}/messages`, {
    token: owner,
    body: { message: 'Yes — available from the first.' },
  });
  inbox = await req('GET', '/leads', { token: owner });
  ok('4a answering records a first-response time', typeof inbox.leads[0].firstResponseSec === 'number', `${inbox.leads[0].firstResponseSec}`);
  ok('4b the lead is no longer awaiting a reply', inbox.leads[0].awaitingReply === false);
  ok('4c summary reports the average', typeof inbox.summary.avgFirstResponseSec === 'number', `${inbox.summary.avgFirstResponseSec}`);

  // ── 5. §2.4 contact reveal ───────────────────────────────────────
  ok('5a identity hidden before the gate', inbox.leads[0].contactRevealed === false && inbox.leads[0].customer === null);
  ok('5b the prospect phone is not in the payload', !JSON.stringify(inbox).includes(buyerPhone));

  await req('PUT', `/viewings/${viewing.id}/status`, { token: owner, body: { status: 'confirmed' } });
  inbox = await req('GET', '/leads', { token: owner });
  ok('5c a confirmed viewing reveals the contact', inbox.leads[0].contactRevealed === true);
  ok('5d the phone appears once revealed', inbox.leads[0].customer?.phone === buyerPhone, inbox.leads[0].customer?.phone ?? 'null');

  // ── 7. filters, with a second prospect for contrast ──────────────
  const buyer2 = await otp(buyer2Phone, 'customer');
  await req('POST', `/properties/${rental.id}/inquire`, { token: buyer2, body: { message: 'Still free?' } });

  inbox = await req('GET', '/leads', { token: owner });
  ok('7a a second prospect is a second lead', inbox.leads.length === 2, `${inbox.leads.length}`);

  const offersOnly = await req('GET', '/leads?stage=offer_made', { token: owner });
  ok('7b stage filter narrows the list', offersOnly.leads.length === 1 && offersOnly.leads[0].stage === 'offer_made');
  ok('7c summary stays whole-inbox under a filter', offersOnly.summary.total === 2, `${offersOnly.summary.total}`);

  const byListing = await req('GET', `/leads?propertyId=${rental.id}`, { token: owner });
  ok('7d listing filter returns that listing only', byListing.leads.every((l) => l.propertyId === rental.id) && byListing.leads.length === 2);
  const otherListing = await req('GET', '/leads?propertyId=does-not-exist', { token: owner });
  ok('7e an unowned listing id yields nothing', otherListing.leads.length === 0);

  // ── 6. §13.4 — mediated resale routes leads to the AGENT ─────────
  const agent = await otp(agentPhone, 'solo_agent');
  for (const dt of ['government_id', 'real_estate_license', 'selfie_with_id']) {
    await req('POST', '/users/me/profile/solo_agent/documents', { token: agent, form: jpeg(dt) });
  }
  await approve(admin, (q) => q.summary?.lister === agentPhone, 'profile');
  const agentId = (await req('GET', '/users/me', { token: agent })).id;

  const resale = await req('POST', '/properties', { token: owner, body: { kind: 'resale' } });
  await req('PUT', `/properties/${resale.id}`, {
    token: owner,
    body: {
      title: `Lead villa ${u}`,
      description: 'Mediated resale used to prove the owner never sees the prospect (§13.4).',
      regionSlug: 'kyrenia', lat: 35.35, lng: 33.33,
      priceAmount: 180000, priceCurrency: 'GBP', bedrooms: 3, bathrooms: 2, areaM2: 150,
      deedType: 'turkish', furnished: false,
    },
  });
  for (let i = 0; i < 5; i++) await req('POST', `/properties/${resale.id}/photos`, { token: owner, form: jpeg() });
  for (const dt of ['title_deed', 'owner_id', 'utility_bill']) {
    await req('POST', `/properties/${resale.id}/documents`, { token: owner, form: pdf(dt) });
  }
  await req('POST', `/properties/${resale.id}/submit`, { token: owner });
  await approve(admin, (q) => q.entityId === resale.id, 'listing');

  await req('POST', `/properties/${resale.id}/assignments`, { token: owner, body: { agentUserIds: [agentId], termMonths: 3 } });
  const assignment = (await req('GET', '/users/me/assignments', { token: agent })).find((x) => x.propertyId === resale.id);
  await req('POST', `/assignments/${assignment.id}/respond`, { token: agent, body: { action: 'accept' } });
  await req('POST', `/assignments/${assignment.id}/publish`, { token: agent, body: { commissionGbp: 5000 } });

  await req('POST', `/properties/${resale.id}/inquire`, { token: buyer2, body: { message: 'Can I see the villa?' } });

  const agentInbox = await req('GET', '/leads', { token: agent });
  ok('6a the publishing agent gets the lead', agentInbox.leads.some((l) => l.propertyId === resale.id), `${agentInbox.leads.length}`);

  const ownerInbox = await req('GET', '/leads', { token: owner });
  ok(
    '6b the owner sees NO lead on their mediated listing',
    !ownerInbox.leads.some((l) => l.propertyId === resale.id),
    ownerInbox.leads.map((l) => l.propertyId).join(','),
  );
  ok('6c the owner-agent channel is never a lead', ownerInbox.leads.every((l) => l.propertyId === rental.id));
  ok('6d the owner still sees their direct listing leads', ownerInbox.leads.length === 2, `${ownerInbox.leads.length}`);

  // ── 8. access control ────────────────────────────────────────────
  ok('8a a customer has no lead inbox', (await expectFail('GET', '/leads', { token: buyer })) === 403);
  ok('8b the inbox is not public', (await expectFail('GET', '/leads')) === 401);

  // Put the platform back how we found it. These suites run against dev
  // databases as well as CI's throwaway one, and silently leaving a disabled
  // feature switched on is a nasty surprise for whoever looks next.
  await restoreOffers();

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL LEAD-INBOX E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  await restoreOffers();
  console.error('E2E ERROR:', e.message);
  process.exit(1);
});
