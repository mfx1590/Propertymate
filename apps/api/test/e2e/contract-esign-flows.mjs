/**
 * Self-contained integration test for contract generation + typed e-sign
 * (Plan §7 rental template "contract (template PDF generated, both e-sign)",
 * §6.2 "simple typed-signature + audit trail at launch"):
 *   1. a contract can only be produced at the contract stage
 *   2. generation renders a real PDF, stored privately, attached to the deal
 *   3. both principals are signatories; agents are not
 *   4. an unsigned contract BLOCKS the stage — this is the whole point
 *   5. typed signatures are recorded with their name, and validated
 *   6. nobody can sign for someone else, or sign twice
 *   7. once both have signed the contract is signed and the deal can advance
 *   8. the counterparty can fetch the PDF; an outsider cannot
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:contracts`.
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-contract')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  // Offers ship disabled (change log 2026-08-10); this suite exercises the
  // negotiation and deal machinery behind the toggle, so turn it on first.
  const offersWereEnabled = Boolean((await req('GET', '/settings/public')).offersEnabled);
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: true } });

  const u = `${Date.now()}`.slice(-7);
  const landlordPhone = `+9053${u}1`;
  const tenantPhone = `+9053${u}2`;
  const outsiderPhone = `+9053${u}3`;

  const landlord = await otp(landlordPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: landlordPhone, planKey: 'owner_basic', months: 12 } });

  // ── a live rental listing ────────────────────────────────────────
  const rental = await req('POST', '/properties', { token: landlord, body: { kind: 'rental' } });
  await req('PUT', `/properties/${rental.id}`, {
    token: landlord,
    body: {
      title: `Tenancy flat ${u}`,
      description: 'Rental listing used to exercise contract generation and typed e-sign.',
      regionSlug: 'kyrenia', lat: 35.34, lng: 33.32,
      priceAmount: 1100, priceCurrency: 'GBP', bedrooms: 2, bathrooms: 1, areaM2: 95,
      deedType: 'turkish', furnished: true,
    },
  });
  for (let i = 0; i < 5; i++) await req('POST', `/properties/${rental.id}/photos`, { token: landlord, form: jpeg() });
  for (const dt of ['title_deed', 'owner_id']) {
    await req('POST', `/properties/${rental.id}/documents`, { token: landlord, form: pdf(dt) });
  }
  await req('POST', `/properties/${rental.id}/submit`, { token: landlord });
  const queue = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
  const item = queue.find((q) => q.entityId === rental.id);
  const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
  await req('POST', `/admin/verification/${item.id}/decision`, {
    token: admin,
    body: { documentDecisions: detail.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });

  // ── offer → rental deal ──────────────────────────────────────────
  const tenant = await otp(tenantPhone, 'customer');
  const offer = await req('POST', `/properties/${rental.id}/offers`, { token: tenant, body: { amount: 1100, currency: 'GBP' } });
  const { dealId } = await req('POST', `/offers/${offer.id}/respond`, { token: landlord, body: { action: 'accept' } });
  ok('0a rental deal opened', !!dealId);

  // accepting a rental offer auto-completes the pre-acceptance stages, so the
  // deal opens straight at the stage where the contract is produced
  let deal = await req('GET', `/deals/${dealId}`, { token: tenant });
  ok('1a rental deal opens at the contract stage', deal.currentStageKey === 'contract', deal.currentStageKey);
  ok(
    '1b no contract exists until one is generated',
    (await req('GET', `/deals/${dealId}/contract`, { token: tenant })).contract === null,
  );

  // ── 2–3. generation ──────────────────────────────────────────────
  const contract = await req('POST', `/deals/${dealId}/contract`, { token: landlord });
  ok('2a contract generated', !!contract.id && contract.kind === 'rental_tenancy');
  ok('2b it starts unsigned', contract.status === 'awaiting_signatures', contract.status);
  ok('2c terms are frozen from the deal snapshot', contract.terms.rentAmount === 1100, JSON.stringify(contract.terms));

  const again = await req('POST', `/deals/${dealId}/contract`, { token: tenant });
  ok('2d generating twice returns the same contract', again.id === contract.id);

  const url = await req('GET', `/documents/${contract.documentId}/url`, { token: landlord });
  ok('2e the PDF is served over a short-lived signed URL', !!url.url && url.expiresInSeconds === 300);
  const fetched = await fetch(url.url);
  const bytes = Buffer.from(await fetched.arrayBuffer());
  ok('2f it is a real PDF', bytes.subarray(0, 5).toString() === '%PDF-', bytes.subarray(0, 8).toString());
  ok('2g of a plausible size', bytes.length > 1500, `${bytes.length} bytes`);

  ok('3a both principals are signatories', contract.signatures.length === 2, `${contract.signatures.length}`);
  ok(
    '3b they are the tenant and the landlord',
    contract.signatures.map((s) => s.partyRole).sort().join(',') === 'buyer,seller',
    contract.signatures.map((s) => s.partyRole).join(','),
  );
  ok('3c neither has signed yet', contract.signatures.every((s) => !s.signed));
  ok('3d the caller sees their own outstanding signature', contract.mySignature?.signed === false);

  // ── 4. an unsigned contract blocks the stage ─────────────────────
  const blocked = await expectFail('POST', `/deals/${dealId}/advance`, { token: landlord });
  ok('4a the stage cannot complete while unsigned', blocked === 400, `status ${blocked}`);

  // ── 5–6. signing ─────────────────────────────────────────────────
  const tooShort = await expectFail('POST', `/contracts/${contract.id}/sign`, { token: tenant, body: { typedName: 'A' } });
  ok('5a a signature needs a real name', tooShort === 400, `status ${tooShort}`);

  const outsider = await otp(outsiderPhone, 'customer');
  const notMine = await expectFail('POST', `/contracts/${contract.id}/sign`, { token: outsider, body: { typedName: 'Someone Else' } });
  ok('6a a stranger cannot sign', notMine === 403, `status ${notMine}`);
  ok('6b a stranger cannot even read it', (await expectFail('GET', `/contracts/${contract.id}`, { token: outsider })) === 403);
  ok(
    '6c a stranger cannot fetch the PDF',
    (await expectFail('GET', `/documents/${contract.documentId}/url`, { token: outsider })) === 403,
  );

  const afterFirst = await req('POST', `/contracts/${contract.id}/sign`, {
    token: tenant,
    body: { typedName: 'Tenant Testerson' },
  });
  ok('5b the typed name is recorded', afterFirst.mySignature.typedName === 'Tenant Testerson');
  ok('5c one signature is not enough', afterFirst.status === 'awaiting_signatures', afterFirst.status);

  const twice = await expectFail('POST', `/contracts/${contract.id}/sign`, { token: tenant, body: { typedName: 'Tenant Testerson' } });
  ok('6d nobody signs twice', twice === 400, `status ${twice}`);

  const stillBlocked = await expectFail('POST', `/deals/${dealId}/advance`, { token: landlord });
  ok('4b one signature still blocks the stage', stillBlocked === 400, `status ${stillBlocked}`);

  const afterBoth = await req('POST', `/contracts/${contract.id}/sign`, {
    token: landlord,
    body: { typedName: 'Landlord Ownerson' },
  });
  ok('7a both signatures complete the contract', afterBoth.status === 'signed', afterBoth.status);
  ok('7b a signed timestamp is recorded', !!afterBoth.signedAt);
  ok('7c both signatures carry names', afterBoth.signatures.every((s) => s.signed && s.typedName));

  // the reprinted PDF must actually contain the typed names
  const signedUrl = await req('GET', `/documents/${contract.documentId}/url`, { token: tenant });
  const signedBytes = Buffer.from(await (await fetch(signedUrl.url)).arrayBuffer());
  ok('7d the counterparty can read the signed PDF', signedBytes.subarray(0, 5).toString() === '%PDF-');
  ok('7e the reprint is larger than the unsigned draft', signedBytes.length > bytes.length, `${bytes.length} → ${signedBytes.length}`);

  // ── 7. the deal can now move on ──────────────────────────────────
  deal = await req('POST', `/deals/${dealId}/advance`, { token: landlord });
  ok('7f a signed contract unblocks the stage', deal.currentStageKey === 'deposit_recorded', deal.currentStageKey);

  const events = (await req('GET', `/deals/${dealId}`, { token: tenant })).events ?? [];
  ok(
    '7g the timeline records generation and signing',
    events.some((e) => e.eventType === 'contract.generated') && events.some((e) => e.eventType === 'contract.signed'),
    events.map((e) => e.eventType).join(','),
  );

  // Put the platform back how we found it. These suites run against dev
  // databases as well as CI's throwaway one, and silently leaving a disabled
  // feature switched on is a nasty surprise for whoever looks next.
  await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: offersWereEnabled } })
    .catch(() => undefined);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CONTRACT E-SIGN E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  // print what did pass — an abort halfway through is far easier to diagnose
  // with the preceding checks visible than with just the failing request
  if (results.length) console.log(results.join('\n'));
  console.error('E2E ERROR:', e.message);
  process.exit(1);
});
