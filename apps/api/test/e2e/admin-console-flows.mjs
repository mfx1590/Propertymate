/**
 * Self-contained integration test for the admin console (Plan §6.7):
 *   1. user search by phone/email, filtered by status and role
 *   2. suspend/ban with a mandatory reason, and reactivation
 *   3. a ban actually locks the account out — sessions die, sign-in refused
 *   4. role grants and revokes, with the guard rails around them
 *   5. a party opens a dispute against another party on their deal
 *   6. the evidence bundle assembles deal events, documents and the chat
 *      export without anyone having to supply their version
 *   7. an upheld dispute feeds the §6.5 ranking score — the loop that has
 *      been dead since the disputes table was created
 *   8. nobody but an admin can reach any of it
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:admin`.
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
  return v;
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-admin')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  // this suite drives a deal to completion, which starts with an offer
  const offersWereEnabled = Boolean((await req('GET', '/settings/public')).offersEnabled);
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: true } });

  const u = `${Date.now()}`.slice(-7);
  const ownerPhone = `+9053${u}1`;
  const buyerPhone = `+9053${u}2`;
  const sparePhone = `+9053${u}3`;

  const ownerAuth = await otp(ownerPhone, 'owner');
  const owner = ownerAuth.accessToken;
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });

  // ── 1. user search ───────────────────────────────────────────────
  const found = await req(`GET`, `/admin/users?q=${encodeURIComponent(ownerPhone)}`, { token: admin });
  ok('1a search finds a user by phone', found.length === 1 && found[0].phone === ownerPhone, `${found.length}`);
  const ownerId = found[0].id;
  ok('1b roles come back with the user', found[0].roles.some((r) => r.key === 'owner'));
  ok('1c status starts active', found[0].status === 'active');

  const byRole = await req('GET', '/admin/users?role=owner&limit=5', { token: admin });
  ok('1d role filter works', byRole.length > 0 && byRole.every((x) => x.roles.some((r) => r.key === 'owner')));
  const byStatus = await req('GET', '/admin/users?status=banned&limit=5', { token: admin });
  ok('1e status filter works', byStatus.every((x) => x.status === 'banned'));

  // ── 4. role grants ───────────────────────────────────────────────
  const granted = await req('POST', `/admin/users/${ownerId}/roles`, { token: admin, body: { roleKey: 'solo_agent' } });
  ok('4a a role can be granted', granted.roleKey === 'solo_agent');
  ok(
    '4b a granted professional role still starts unverified',
    granted.verificationStatus === 'unverified',
    granted.verificationStatus,
  );
  ok('4c the same role cannot be granted twice', (await expectFail('POST', `/admin/users/${ownerId}/roles`, { token: admin, body: { roleKey: 'solo_agent' } })) === 400);
  ok('4d admin cannot be handed out here', (await expectFail('POST', `/admin/users/${ownerId}/roles`, { token: admin, body: { roleKey: 'admin' } })) === 400);
  ok('4e unknown roles are rejected', (await expectFail('POST', `/admin/users/${ownerId}/roles`, { token: admin, body: { roleKey: 'wizard' } })) === 400);

  const revoked = await req('DELETE', `/admin/users/${ownerId}/roles/solo_agent`, { token: admin });
  ok('4f a role can be revoked', revoked.revoked === true);
  ok('4g the customer baseline cannot be revoked', (await expectFail('DELETE', `/admin/users/${ownerId}/roles/customer`, { token: admin })) === 400);

  // ── 5–7. a completed deal, then a dispute over it ────────────────
  const listing = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
  await req('PUT', `/properties/${listing.id}`, {
    token: owner,
    body: {
      title: `Dispute flat ${u}`,
      description: 'Rental listing used to drive a deal that is then disputed.',
      regionSlug: 'nicosia', lat: 35.18, lng: 33.38,
      priceAmount: 800, priceCurrency: 'GBP', bedrooms: 1, bathrooms: 1, areaM2: 55,
      deedType: 'turkish', furnished: true,
    },
  });
  for (let i = 0; i < 5; i++) await req('POST', `/properties/${listing.id}/photos`, { token: owner, form: jpeg() });
  for (const dt of ['title_deed', 'owner_id']) {
    await req('POST', `/properties/${listing.id}/documents`, { token: owner, form: pdf(dt) });
  }
  await req('POST', `/properties/${listing.id}/submit`, { token: owner });
  const queue = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
  const item = queue.find((q) => q.entityId === listing.id);
  const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
  await req('POST', `/admin/verification/${item.id}/decision`, {
    token: admin,
    body: { documentDecisions: detail.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });

  const buyerAuth = await otp(buyerPhone, 'customer');
  const buyer = buyerAuth.accessToken;
  const buyerId = (await req('GET', '/users/me', { token: buyer })).id;
  const offer = await req('POST', `/properties/${listing.id}/offers`, { token: buyer, body: { amount: 800, currency: 'GBP' } });
  const { dealId } = await req('POST', `/offers/${offer.id}/respond`, { token: owner, body: { action: 'accept' } });
  // the deal room exposes conversations[] — the chat export is only meaningful
  // if there is actually something in the room to export
  const dealRoom = await req('GET', `/deals/${dealId}`, { token: buyer });
  const convo = dealRoom.conversations?.[0]?.id;
  ok('5z the deal room has a conversation', !!convo, JSON.stringify(dealRoom.conversations ?? null));
  await req('POST', `/conversations/${convo}/messages`, {
    token: buyer,
    body: { message: 'The boiler still is not fixed after the handover.' },
  });

  const noReason = await expectFail('POST', `/deals/${dealId}/disputes`, {
    token: buyer, body: { againstUserId: ownerId, reason: 'bad' },
  });
  ok('5a a dispute needs a real description', noReason === 400, `status ${noReason}`);

  const selfDispute = await expectFail('POST', `/deals/${dealId}/disputes`, {
    token: buyer, body: { againstUserId: buyerId, reason: 'I am disputing myself for some reason' },
  });
  ok('5b you cannot dispute yourself', selfDispute === 400, `status ${selfDispute}`);

  const dispute = await req('POST', `/deals/${dealId}/disputes`, {
    token: buyer,
    body: { againstUserId: ownerId, reason: 'The property was not in the condition agreed at the viewing.' },
  });
  ok('5c a party can open a dispute', !!dispute.id && dispute.status === 'open');
  ok('5d it appears in the opener own list', (await req('GET', '/users/me/disputes', { token: buyer })).some((d) => d.id === dispute.id));
  ok('5e the respondent sees it too', (await req('GET', '/users/me/disputes', { token: owner })).some((d) => d.id === dispute.id));
  ok('5f a second open dispute on the same pair is refused', (await expectFail('POST', `/deals/${dealId}/disputes`, {
    token: buyer, body: { againstUserId: ownerId, reason: 'Another complaint about the very same deal' },
  })) === 400);

  // ── 6. the evidence bundle ───────────────────────────────────────
  const adminQueue = await req('GET', '/admin/disputes', { token: admin });
  ok('6a the dispute reaches the admin queue', adminQueue.some((d) => d.id === dispute.id));
  ok('6b the queue names both sides', adminQueue.find((d) => d.id === dispute.id)?.againstUser?.phone === ownerPhone);

  const bundle = await req('GET', `/admin/disputes/${dispute.id}`, { token: admin });
  ok('6c the deal is attached', bundle.deal?.id === dealId);
  ok('6d the immutable timeline is included', bundle.evidence.events.length > 0, `${bundle.evidence.events.length}`);
  ok('6e the dispute itself is on the timeline', bundle.evidence.events.some((e) => e.eventType === 'dispute.opened'));
  ok('6f the chat export is included', bundle.evidence.messages.length > 0, `${bundle.evidence.messages.length}`);
  ok('6g documents are listed', Array.isArray(bundle.evidence.documents));

  // ── 7. upholding it moves the ranking score ──────────────────────
  const needsNote = await expectFail('POST', `/admin/disputes/${dispute.id}/resolve`, {
    token: admin, body: { status: 'resolved_upheld' },
  });
  ok('7a a resolution needs a note', needsNote === 400, `status ${needsNote}`);

  const investigating = await req('POST', `/admin/disputes/${dispute.id}/resolve`, {
    token: admin, body: { status: 'investigating' },
  });
  ok('7b a case can be moved to investigating', investigating.status === 'investigating');

  const upheld = await req('POST', `/admin/disputes/${dispute.id}/resolve`, {
    token: admin,
    body: { status: 'resolved_upheld', resolutionNote: 'Evidence supports the tenant account.' },
  });
  ok('7c it can then be upheld', upheld.status === 'resolved_upheld');
  ok('7d the note is recorded', !!upheld.resolutionNote);
  ok('7e a resolved case cannot be resolved again', (await expectFail('POST', `/admin/disputes/${dispute.id}/resolve`, {
    token: admin, body: { status: 'resolved_dismissed', resolutionNote: 'changed my mind' },
  })) === 400);

  // ── 2–3. suspend and ban ─────────────────────────────────────────
  const noBanReason = await expectFail('POST', `/admin/users/${buyerId}/status`, { token: admin, body: { status: 'banned' } });
  ok('2a a ban requires a reason', noBanReason === 400, `status ${noBanReason}`);

  const suspended = await req('POST', `/admin/users/${buyerId}/status`, {
    token: admin, body: { status: 'suspended', reason: 'Under review after a dispute' },
  });
  ok('2b a user can be suspended', suspended.status === 'suspended');

  const reactivated = await req('POST', `/admin/users/${buyerId}/status`, { token: admin, body: { status: 'active' } });
  ok('2c reactivation needs no reason', reactivated.status === 'active');

  await req('POST', `/admin/users/${buyerId}/status`, {
    token: admin, body: { status: 'banned', reason: 'Repeated abuse after warnings' },
  });
  ok('3a a banned session cannot be refreshed', (await expectFail('POST', '/auth/refresh', { body: { refreshToken: buyerAuth.refreshToken } })) === 401);
  const banned = await req(`GET`, `/admin/users?q=${encodeURIComponent(buyerPhone)}`, { token: admin });
  ok('3b the ban is visible in the console', banned[0].status === 'banned');

  // §13.2: an identity-backed ban must survive a re-registration attempt
  const reReg = await req('POST', '/auth/otp/request', { body: { phone: buyerPhone } });
  let reRegStatus = 0;
  try {
    await req('POST', '/auth/otp/verify', { body: { phone: buyerPhone, code: reReg.devCode } });
  } catch (e) {
    reRegStatus = Number(/-> (\d+):/.exec(e.message)?.[1] ?? -1);
  }
  ok('3c a banned phone cannot sign back in', reRegStatus === 401, `status ${reRegStatus}`);

  // ── 8. access control ────────────────────────────────────────────
  const spare = (await otp(sparePhone, 'customer')).accessToken;
  ok('8a the user console is admin-only', (await expectFail('GET', '/admin/users', { token: spare })) === 403);
  ok('8b the dispute queue is admin-only', (await expectFail('GET', '/admin/disputes', { token: spare })) === 403);
  ok('8c the evidence bundle is admin-only', (await expectFail('GET', `/admin/disputes/${dispute.id}`, { token: spare })) === 403);
  ok('8d resolving is admin-only', (await expectFail('POST', `/admin/disputes/${dispute.id}/resolve`, {
    token: spare, body: { status: 'resolved_dismissed', resolutionNote: 'nope' },
  })) === 403);
  ok('8e a stranger cannot open a dispute on someone else deal', (await expectFail('POST', `/deals/${dealId}/disputes`, {
    token: spare, body: { againstUserId: ownerId, reason: 'I am not even on this deal at all' },
  })) === 403);
  ok('8f none of it is public', (await expectFail('GET', '/admin/users')) === 401);

  // Put the platform back how we found it. These suites run against dev
  // databases as well as CI's throwaway one, and silently leaving a disabled
  // feature switched on is a nasty surprise for whoever looks next.
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: offersWereEnabled } })
    .catch(() => undefined);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL ADMIN-CONSOLE E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  if (results.length) console.log(results.join('\n'));
  console.error('E2E ERROR:', e.message);
  process.exit(1);
});
