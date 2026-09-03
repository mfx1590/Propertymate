/**
 * Self-contained integration test for the agent mandate (Plan §6.2, §13.4):
 *   1. a mandate only exists once the agent has accepted the instruction
 *   2. either party can generate it, and generating twice returns the same one
 *   3. only the owner and the appointed agent can see or sign it — a stranger,
 *      and an agent on a different assignment, are both refused
 *   4. it takes two signatures; one leaves it awaiting the other
 *   5. the terms recorded are the ones §13.4 actually turns on — the owner's
 *      ask, the term, and the expiry
 *   6. with `mandate.required_before_publish` ON, publishing is refused until
 *      the mandate is signed, and allowed after
 *   7. the PDF is a real PDF, served over a permission-checked link
 *   8. the contract renders in the generating party's language — a Russian
 *      owner gets a Russian mandate, with the fallback recorded for scripts
 *      that cannot be shaped
 *   9. a purchase deal produces a SALE agreement, not a tenancy — the resale
 *      pipeline's document, at its own stage, naming buyer and seller
 *
 * Creates every account, listing and assignment it asserts on. The publish gate
 * is a platform setting, so it is restored in a `finally`.
 * Run against a live API: `npm run test:e2e:mandate`.
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
function jpeg(documentType) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(JPEG_B64, 'base64')], { type: 'image/jpeg' }), 'x.jpg');
  if (documentType) fd.append('documentType', documentType);
  return fd;
}
function pdf(documentType) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-mandate')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

const OWNER_ASK = 240000;

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const before = await req('GET', '/admin/settings', { token: admin });
  const gateBefore = before.find((s) => s.key === 'mandate.required_before_publish')?.value ?? null;

  try {
    const u = `${Date.now()}`.slice(-7);
    const ownerPhone = `+9053${u}1`;
    const agentPhone = `+9053${u}2`;
    const otherAgentPhone = `+9053${u}3`;
    const strangerPhone = `+9053${u}4`;

    // ── a verified agent, a second agent, an owner, a bystander ────
    async function verifiedAgent(phone) {
      const token = await otp(phone, 'solo_agent');
      for (const dt of ['government_id', 'real_estate_license', 'selfie_with_id']) {
        await req('POST', '/users/me/profile/solo_agent/documents', { token, form: jpeg(dt) });
      }
      const queue = await req('GET', '/admin/verification/queue?entityType=profile', { token: admin });
      const item = queue.find((q) => q.summary?.lister === phone || q.summary?.phone === phone);
      const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
      await req('POST', `/admin/verification/${item.id}/decision`, {
        token: admin,
        body: { documentDecisions: detail.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
      });
      const id = (await req('GET', '/users/me', { token })).id;
      return { token, id };
    }

    const agent = await verifiedAgent(agentPhone);
    const otherAgent = await verifiedAgent(otherAgentPhone);
    const owner = await otp(ownerPhone, 'owner');
    await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });
    const stranger = await otp(strangerPhone, 'customer');

    // ── a verified private resale ─────────────────────────────────
    const p = await req('POST', '/properties', { token: owner, body: { kind: 'resale' } });
    await req('PUT', `/properties/${p.id}`, {
      token: owner,
      body: {
        title: `Mandate villa ${u}`,
        description: 'Listing used to exercise the §13.4 agent mandate.',
        regionSlug: 'kyrenia', lat: 35.34, lng: 33.32,
        priceAmount: OWNER_ASK, priceCurrency: 'GBP', bedrooms: 3, bathrooms: 2, areaM2: 150,
        deedType: 'turkish', furnished: true,
      },
    });
    for (let i = 0; i < 5; i++) await req('POST', `/properties/${p.id}/photos`, { token: owner, form: jpeg() });
    for (const dt of ['title_deed', 'owner_id', 'utility_bill']) {
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

    await req('POST', `/properties/${p.id}/assignments`, {
      token: owner,
      body: { agentUserIds: [agent.id, otherAgent.id], termMonths: 6 },
    });
    const mine = await req('GET', '/users/me/assignments', { token: agent.token });
    const assignment = mine.find((x) => x.propertyId === p.id);
    ok('0a the agent has an invited assignment', assignment?.status === 'invited', assignment?.status);

    // ── 1. no mandate before acceptance ───────────────────────────
    ok(
      '1a a mandate cannot be raised on an unanswered invitation',
      (await expectFail('POST', `/assignments/${assignment.id}/mandate`, { token: agent.token })) === 400,
    );
    const none = await req('GET', `/assignments/${assignment.id}/mandate`, { token: agent.token });
    ok('1b and none exists to read', none.mandate === null, JSON.stringify(none));

    await req('POST', `/assignments/${assignment.id}/respond`, { token: agent.token, body: { action: 'accept' } });

    // ── 2. generation is idempotent and open to either party ──────
    const mandate = await req('POST', `/assignments/${assignment.id}/mandate`, { token: agent.token });
    ok('2a accepting unlocks the mandate', mandate.kind === 'agent_mandate', mandate.kind);
    ok('2b it starts awaiting signatures', mandate.status === 'awaiting_signatures', mandate.status);
    ok('2c with two signatories', mandate.signatures?.length === 2, `${mandate.signatures?.length}`);

    const again = await req('POST', `/assignments/${assignment.id}/mandate`, { token: owner });
    ok('2d regenerating returns the same mandate', again.id === mandate.id, `${mandate.id} vs ${again.id}`);
    const ownerView = await req('GET', `/assignments/${assignment.id}/mandate`, { token: owner });
    ok('2e the owner sees the same document', ownerView.mandate?.id === mandate.id);

    // ── 3. only the two parties ───────────────────────────────────
    ok(
      '3a a stranger cannot read it',
      (await expectFail('GET', `/assignments/${assignment.id}/mandate`, { token: stranger })) === 403,
    );
    ok(
      '3b nor an agent on a different assignment',
      (await expectFail('GET', `/assignments/${assignment.id}/mandate`, { token: otherAgent.token })) === 403,
    );
    ok(
      '3c and a stranger cannot sign it',
      (await expectFail('POST', `/contracts/${mandate.id}/sign`, { token: stranger, body: { typedName: 'Not Me' } })) === 403,
    );

    // ── 4. two signatures ─────────────────────────────────────────
    const afterAgent = await req('POST', `/contracts/${mandate.id}/sign`, {
      token: agent.token,
      body: { typedName: 'Agent Example' },
    });
    ok('4a one signature is not enough', afterAgent.status === 'awaiting_signatures', afterAgent.status);
    ok(
      '4b the signed party is recorded',
      afterAgent.signatures.filter((s) => s.signed).length === 1,
      JSON.stringify(afterAgent.signatures.map((s) => s.signed)),
    );

    // ── 6a. the gate refuses while it is unsigned ─────────────────
    await req('PUT', '/admin/settings/mandate.required_before_publish', { token: admin, body: { value: true } });
    const blocked = await expectFail('POST', `/assignments/${assignment.id}/publish`, {
      token: agent.token,
      body: { commissionGbp: 5000 },
    });
    ok('6a publishing is refused while the mandate is unsigned', blocked === 400, `status ${blocked}`);

    const afterOwner = await req('POST', `/contracts/${mandate.id}/sign`, {
      token: owner,
      body: { typedName: 'Owner Example' },
    });
    ok('4c the second signature completes it', afterOwner.status === 'signed', afterOwner.status);
    ok('4d and stamps a signed time', !!afterOwner.signedAt);

    // ── 5. the recorded terms ─────────────────────────────────────
    const terms = afterOwner.terms ?? mandate.terms ?? {};
    ok('5a the owner ask is recorded', Number(terms.ownerAskGbp) === OWNER_ASK, `${terms.ownerAskGbp}`);
    ok('5b the term is recorded', Number(terms.termMonths) === 6, `${terms.termMonths}`);
    ok('5c and an expiry date', !!terms.expiresAt, `${terms.expiresAt}`);

    // ── 6b. signed unblocks publishing ────────────────────────────
    const published = await req('POST', `/assignments/${assignment.id}/publish`, {
      token: agent.token,
      body: { commissionGbp: 5000 },
    });
    ok('6b a signed mandate unblocks publishing', !!published.propertyId || !!published.status, JSON.stringify(published).slice(0, 120));

    // ── 7. the PDF ────────────────────────────────────────────────
    const link = await req('GET', `/documents/${mandate.documentId}/url`, { token: owner });
    const bytes = Buffer.from(await (await fetch(link.url)).arrayBuffer());
    ok('7a the mandate renders a real PDF', bytes.subarray(0, 5).toString() === '%PDF-', bytes.subarray(0, 5).toString());
    ok('7b of a plausible size', bytes.length > 1000, `${bytes.length} bytes`);
    ok('7c the English mandate is recorded as English', mandate.terms?.locale === 'en', `${mandate.terms?.locale}`);

    // ── 8. a Russian owner gets a Russian mandate ─────────────────
    // Registered by email so the locale can be set at signup; the whole path
    // runs again rather than only asserting the plumbing.
    const ruOwner = (await req('POST', '/auth/register', {
      body: {
        email: `ru-owner-${u}@example.com`,
        password: 'Str0ngPassw0rd!',
        locale: 'ru',
        accountType: 'owner',
      },
    })).accessToken;
    await req('POST', '/admin/subscriptions/grant', {
      token: admin,
      body: { identifier: `ru-owner-${u}@example.com`, planKey: 'owner_basic', months: 12 },
    });

    const p2 = await req('POST', '/properties', { token: ruOwner, body: { kind: 'resale' } });
    await req('PUT', `/properties/${p2.id}`, {
      token: ruOwner,
      body: {
        title: `Mandate villa RU ${u}`,
        description: 'Second listing, so the mandate can be generated by a Russian-locale owner.',
        regionSlug: 'kyrenia', lat: 35.35, lng: 33.33,
        priceAmount: 180000, priceCurrency: 'GBP', bedrooms: 2, bathrooms: 1, areaM2: 110,
        deedType: 'turkish', furnished: false,
      },
    });
    for (let i = 0; i < 5; i++) await req('POST', `/properties/${p2.id}/photos`, { token: ruOwner, form: jpeg() });
    for (const dt of ['title_deed', 'owner_id', 'utility_bill']) {
      await req('POST', `/properties/${p2.id}/documents`, { token: ruOwner, form: pdf(dt) });
    }
    await req('POST', `/properties/${p2.id}/submit`, { token: ruOwner });
    const q2 = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
    const i2 = q2.find((q) => q.entityId === p2.id);
    const d2 = await req('GET', `/admin/verification/${i2.id}`, { token: admin });
    await req('POST', `/admin/verification/${i2.id}/decision`, {
      token: admin,
      body: { documentDecisions: d2.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
    });

    await req('POST', `/properties/${p2.id}/assignments`, {
      token: ruOwner,
      body: { agentUserIds: [agent.id], termMonths: 3 },
    });
    const a2 = (await req('GET', '/users/me/assignments', { token: agent.token })).find((x) => x.propertyId === p2.id);
    await req('POST', `/assignments/${a2.id}/respond`, { token: agent.token, body: { action: 'accept' } });

    // Generated BY the Russian owner, so the document takes their language.
    const ruMandate = await req('POST', `/assignments/${a2.id}/mandate`, { token: ruOwner });
    ok('8a a Russian owner gets a Russian mandate', ruMandate.terms?.locale === 'ru', `${ruMandate.terms?.locale}`);
    ok('8b the requested locale is recorded too', ruMandate.terms?.requestedLocale === 'ru', `${ruMandate.terms?.requestedLocale}`);

    const { PDFDocument } = await import('pdf-lib');

    // ── 9. a purchase deal produces a sale agreement ──────────────
    // The mandate is signed and the listing is live, so the resale can now run
    // to its contract stage and produce the other document this module makes.
    await req('POST', `/contracts/${ruMandate.id}/sign`, { token: ruOwner, body: { typedName: 'RU Owner' } });
    await req('POST', `/contracts/${ruMandate.id}/sign`, { token: agent.token, body: { typedName: 'Agent Example' } });
    await req('POST', `/assignments/${a2.id}/publish`, { token: agent.token, body: { commissionGbp: 4000 } });

    const offersWere = Boolean((await req('GET', '/settings/public')).offersEnabled);
    await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: true } });
    try {
      const buyer = await otp(`+9053${u}5`, 'customer');
      const offer = await req('POST', `/properties/${p2.id}/offers`, {
        token: buyer,
        body: { amount: 178000, currency: 'GBP' },
      });
      const { dealId } = await req('POST', `/offers/${offer.id}/respond`, {
        token: agent.token,
        body: { action: 'accept' },
      });
      // legal_check -> contract_signing
      await req('POST', `/deals/${dealId}/advance`, { token: buyer });

      const sale = await req('POST', `/deals/${dealId}/contract`, { token: buyer });
      ok('9a a purchase deal produces a sale agreement', sale.kind === 'purchase_sale', sale.kind);
      ok('9b not a tenancy', sale.kind !== 'rental_tenancy');
      ok('9c the agreed price is recorded', Number(sale.terms?.priceAgreed) === 178000, `${sale.terms?.priceAgreed}`);
      ok('9d the deed type is recorded', !!sale.terms?.deedType, `${sale.terms?.deedType}`);

      const saleLink = await req('GET', `/documents/${sale.documentId}/url`, { token: buyer });
      const saleBytes = Buffer.from(await (await fetch(saleLink.url)).arrayBuffer());
      const saleTitle = (await PDFDocument.load(saleBytes)).getTitle() ?? '';
      ok('9e the PDF is titled as a sale agreement', /Sale and Purchase/i.test(saleTitle), JSON.stringify(saleTitle));
    } finally {
      await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: offersWere } })
        .catch(() => undefined);
    }

    const ruLink = await req('GET', `/documents/${ruMandate.documentId}/url`, { token: ruOwner });
    const ruBytes = Buffer.from(await (await fetch(ruLink.url)).arrayBuffer());
    ok('8c it renders a real PDF', ruBytes.subarray(0, 5).toString() === '%PDF-');
    // Cyrillic used to be transliterated away by the WinAnsi font. Reading the
    // title back out of the rendered PDF is the decisive check that the
    // embedded Unicode face is actually in use.
    const ruTitle = (await PDFDocument.load(ruBytes)).getTitle() ?? '';
    ok('8d the PDF title is in Cyrillic', /[Ѐ-ӿ]/.test(ruTitle), JSON.stringify(ruTitle));
    ok('8e and is the mandate title, not the tenancy one', ruTitle.includes('мандат') || ruTitle.includes('Агентский'), JSON.stringify(ruTitle));
  } finally {
    // Put the gate back exactly as found — this suite runs against dev
    // databases too, and leaving it on would block every later publish.
    await req('PUT', '/admin/settings/mandate.required_before_publish', {
      token: admin,
      body: { value: gateBefore === null ? false : gateBefore },
    }).catch(() => undefined);
  }

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL AGENT-MANDATE E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
