/**
 * Self-contained integration test for the lawyer marketplace (Plan §10.2
 * Phase 3, first item; §2.2 service-provider abstraction).
 *
 * Two claims are on trial here.
 *
 * **§2.2 said adding a lateral role would be config plus one module, with zero
 * changes to core.** So the suite drives a lawyer through the *generic*
 * surfaces — the same signup, the same profile endpoint, the same verification
 * queue every other professional role uses — and asserts they work untouched.
 * A check that passed only through a lawyer-specific endpoint would prove the
 * opposite of what it looks like.
 *
 * **§2.2 also said the stage config declares which service types may attach
 * where.** That declaration has existed in the seed since Phase 1 and nothing
 * has ever read it. Now something does, so the suite pins it from both sides:
 * the same request, by the same person, on the same deal, is refused at
 * `reservation` and allowed one stage later at `legal_check` — with nothing
 * changed but the deal's position in a pipeline defined in data.
 *
 *   1. a lawyer registers, is pending, and is invisible until verified
 *   2. the injection point decides — refused at one stage, allowed at the next
 *   3. quote → accept puts the lawyer in the deal room, and closes the requests
 *      the client no longer needs
 *   4. one side's lawyer never becomes the other side's
 *   5. withdrawing, declining, and what cannot be undone
 *
 * Everything asserted on is created here. No global setting is touched, so
 * there is nothing to restore — the negative stage test uses the deal's own
 * starting stage rather than flipping `offers.enabled` to reach a rental.
 *
 * Run against a live API: `npm run test:e2e:legal`.
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
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
/** The error text, for asserting that a refusal explains itself. */
async function failMessage(method, path, opts = {}) {
  try {
    await req(method, path, opts);
    return '';
  } catch (e) {
    return e.message;
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
  // Salted per upload: every fixture in this repo otherwise shares one sha256,
  // and §13.2 identity-ban durability keys on that hash (step 21). A run that
  // reused the flat bytes could trip a ban left behind by another suite.
  fd.append('file', new Blob([Buffer.from(`%PDF-1.4 e2e-legal ${salt}`)], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const TAG = `zqxlegal${u}`;

  const devPhone = `+9053${u}5`;
  const buyerPhone = `+9053${u}6`;
  const lawyerAPhone = `+9053${u}7`;
  const lawyerBPhone = `+9053${u}8`;
  const lawyerCPhone = `+9053${u}9`;

  const dev = await otp(devPhone, 'developer');
  const buyer = await otp(buyerPhone, 'customer');
  const lawyerA = await otp(lawyerAPhone, 'lawyer');
  const lawyerB = await otp(lawyerBPhone, 'lawyer');
  const lawyerC = await otp(lawyerCPhone, 'lawyer');

  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: devPhone, planKey: 'developer_basic', months: 12 } });

  /**
   * Approve a pending professional profile through the ORDINARY queue — the
   * same endpoints an agency or developer goes through. Nothing here is
   * lawyer-specific, which is the §2.2 claim being tested.
   */
  async function verifyProfile(token, phone, label) {
    for (const [dt, i] of [['government_id', 1], ['bar_license', 2], ['selfie_with_id', 3]]) {
      await req('POST', '/users/me/profile/lawyer/documents', { token, form: pdf(dt, `${TAG}-${label}-${i}`) });
    }
    const queue = await req('GET', '/admin/verification/queue?entityType=profile', { token: admin });
    const item = queue.find((q) => q.summary?.lister === phone);
    if (!item) throw new Error(`no profile queue item for ${phone}`);
    const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
    await req('POST', `/admin/verification/${item.id}/decision`, {
      token: admin,
      body: {
        documentDecisions: detail.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })),
      },
    });
  }

  // ── 1. a lateral role, through the generic surfaces ───────────────
  const rolesA = await req('GET', '/users/me/roles', { token: lawyerA });
  const lawyerRoleA = rolesA.find((r) => r.role.key === 'lawyer');
  ok('1a signing up as a lawyer grants the lawyer role', !!lawyerRoleA, rolesA.map((r) => r.role.key).join(','));
  ok('1b a professional role starts pending, not verified', lawyerRoleA?.verificationStatus === 'pending', lawyerRoleA?.verificationStatus);

  // The profile extension is edited through the SAME endpoint every other role
  // uses. §2.2's claim was "zero changes to core", and this is where it is
  // either true or it is not.
  const savedProfile = await req('PUT', '/users/me/profile/lawyer', {
    token: lawyerA,
    body: {
      firmName: `${TAG} Yilmaz Legal`,
      barNo: 'KKTC-1234',
      bio: 'Conveyancing and purchase permits for overseas buyers.',
      regions: ['kyrenia', 'iskele'],
      languages: ['en', 'tr', 'ru'],
      feeModel: 'fixed',
      feeNote: 'Typically £1,200 fixed for a resale purchase.',
    },
  });
  ok('1c the generic profile endpoint writes a lawyer profile', savedProfile?.firmName === `${TAG} Yilmaz Legal`, JSON.stringify(savedProfile?.firmName));
  ok('1d it keeps the whitelist honest', savedProfile?.barNo === 'KKTC-1234' && savedProfile?.languages?.length === 3);

  const rejected = await expectFail('PUT', '/users/me/profile/lawyer', {
    token: lawyerA,
    body: { firmName: 'x', feeModel: 'whatever-i-like' },
  });
  ok('1e an unknown fee model is refused', rejected === 400, `status ${rejected}`);

  // The bar licence §2.2 predicted as "one seed row", served from the same
  // public config endpoint that drives every other role's upload UI.
  const reqs = await req('GET', '/roles/lawyer/requirements');
  const reqTypes = reqs.map((r) => r.documentType);
  ok('1f the bar licence is a config-driven requirement', reqTypes.includes('bar_license'), JSON.stringify(reqTypes));
  ok('1g and it is required, not optional', reqs.find((r) => r.documentType === 'bar_license')?.isRequired === true);

  const dirHasTag = (dir) => dir.filter((l) => l.name.includes(TAG));
  const beforeVerify = await req('GET', '/lawyers/directory');
  ok('1h nothing of this suite is listed before verification', dirHasTag(beforeVerify).length === 0, `${dirHasTag(beforeVerify).length}`);

  await verifyProfile(lawyerA, lawyerAPhone, 'A');
  await req('PUT', '/users/me/profile/lawyer', {
    token: lawyerB,
    body: { firmName: `${TAG} Demir & Co`, regions: ['famagusta'], languages: ['en'], feeModel: 'hourly' },
  });
  await verifyProfile(lawyerB, lawyerBPhone, 'B');
  // C is left unverified on purpose.
  await req('PUT', '/users/me/profile/lawyer', { token: lawyerC, body: { firmName: `${TAG} Unverified Legal` } });

  const dir = await req('GET', '/lawyers/directory');
  const mine = dirHasTag(dir);
  ok('2a a verified lawyer appears in the directory', mine.length === 2, `${mine.length}`);
  ok('2b the unverified one still does not', !dir.some((l) => l.name.includes('Unverified Legal')));
  ok('2c the directory is public — no token was sent', Array.isArray(dir));

  const byRegion = dirHasTag(await req('GET', '/lawyers/directory?region=kyrenia'));
  ok('2d region filters to those who serve it', byRegion.length === 1 && byRegion[0].name.includes('Yilmaz'), byRegion.map((l) => l.name).join(','));
  const byLang = dirHasTag(await req('GET', '/lawyers/directory?language=ru'));
  ok('2e language filters too', byLang.length === 1 && byLang[0].name.includes('Yilmaz'), byLang.map((l) => l.name).join(','));

  const lawyerAId = mine.find((l) => l.name.includes('Yilmaz')).userId;
  const lawyerBId = mine.find((l) => l.name.includes('Demir')).userId;
  const publicProfile = await req('GET', `/lawyers/${lawyerAId}`);
  const publicJson = JSON.stringify(publicProfile);
  ok('2f a public profile is readable signed-out', publicProfile.userId === lawyerAId);
  ok('2g it never carries the bar number, phone or documents', !publicJson.includes('KKTC-1234') && !publicJson.includes(lawyerAPhone) && !publicJson.includes('barNo'), publicJson.slice(0, 160));

  // ── 3. the deal, and the injection point ─────────────────────────
  const project = await req('POST', '/projects', { token: dev });
  await req('PUT', `/projects/${project.id}`, {
    token: dev,
    body: {
      name: `${TAG} Seaside`,
      description: 'Off-plan project used to exercise the lawyer marketplace injection point.',
      regionSlug: 'iskele',
      lat: 35.28,
      lng: 33.89,
      deliveryDate: '2028-06-30',
    },
  });
  for (let i = 0; i < 3; i++) await req('POST', `/projects/${project.id}/photos`, { token: dev, form: jpeg() });
  for (const dt of ['construction_permit', 'project_plans']) {
    await req('POST', `/projects/${project.id}/documents`, { token: dev, form: pdf(dt, `${TAG}-proj-${dt}`) });
  }
  await req('POST', `/projects/${project.id}/units`, {
    token: dev,
    body: { unitNo: 'A-1', type: '2+1', bedrooms: 2, areaM2: 90, floor: 1, priceAmount: 150000, priceCurrency: 'GBP' },
  });
  await req('POST', `/projects/${project.id}/submit`, { token: dev });
  const pq = await req('GET', '/admin/verification/queue?entityType=project', { token: admin });
  const pitem = pq.find((q) => q.entityId === project.id);
  const pdetail = await req('GET', `/admin/verification/${pitem.id}`, { token: admin });
  await req('POST', `/admin/verification/${pitem.id}/decision`, {
    token: admin,
    body: {
      documentDecisions: (pdetail.project?.documents ?? pdetail.documents ?? []).map((d) => ({ documentId: d.id, status: 'approved' })),
    },
  });

  const publicProject = await req('GET', `/projects/${project.id}`);
  const unit = publicProject.units.find((x) => x.status === 'available');
  const { dealId } = await req('POST', `/units/${unit.id}/reserve`, { token: buyer });
  ok('3a reserving a unit opened an off-plan deal', !!dealId);

  let deal = await req('GET', `/deals/${dealId}`, { token: buyer });
  ok('3b the deal opens at the reservation stage', deal.currentStageKey === 'reservation', deal.currentStageKey);

  // THE CHECK THIS WHOLE MODULE EXISTS FOR. `reservation` declares no
  // injectable service types; `legal_check`, one stage later, declares lawyer.
  const tooEarly = await failMessage('POST', `/deals/${dealId}/legal/requests`, {
    token: buyer,
    body: { lawyerUserIds: [lawyerAId] },
  });
  ok('3c a lawyer cannot be engaged at a stage that does not declare one', tooEarly.includes('-> 400'), tooEarly.slice(0, 120));
  ok('3d and the refusal names the stages that do', tooEarly.includes('legal_check') && tooEarly.includes('permit_process'), tooEarly.slice(0, 200));

  await req('POST', `/deals/${dealId}/advance`, { token: dev }); // reservation → legal_check
  deal = await req('GET', `/deals/${dealId}`, { token: buyer });
  ok('3e the deal advanced to legal_check', deal.currentStageKey === 'legal_check', deal.currentStageKey);

  const requested = await req('POST', `/deals/${dealId}/legal/requests`, {
    token: buyer,
    body: { lawyerUserIds: [lawyerAId, lawyerBId], scope: 'Title search and purchase permit.' },
  });
  ok('3f the same request now succeeds — only the stage changed', Array.isArray(requested) && requested.length === 2, `${requested.length}`);
  ok('3g the stage that authorised it is recorded', requested.every((r) => r.stageKey === 'legal_check'), requested.map((r) => r.stageKey).join(','));

  const lawyerCId = (await req('GET', '/users/me', { token: lawyerC })).id;
  const unverifiedAsk = await expectFail('POST', `/deals/${dealId}/legal/requests`, {
    token: buyer,
    body: { lawyerUserIds: [lawyerCId] },
  });
  ok('3h an unverified lawyer cannot be engaged', unverifiedAsk === 400, `status ${unverifiedAsk}`);
  const strangerAsk = await expectFail('POST', `/deals/${dealId}/legal/requests`, {
    token: lawyerC,
    body: { lawyerUserIds: [lawyerAId] },
  });
  ok('3i a non-party cannot request on someone else’s deal', strangerAsk === 403, `status ${strangerAsk}`);

  // ── 4. quote → accept ────────────────────────────────────────────
  const inboxA = await req('GET', '/legal/engagements', { token: lawyerA });
  const mineA = inboxA.filter((e) => e.dealId === dealId);
  ok('4a the lawyer sees the request in their inbox', mineA.length === 1 && mineA[0].status === 'requested', JSON.stringify(mineA.map((e) => e.status)));
  // An off-plan deal has no property row, so a naive title lookup returns a
  // placeholder for every reservation — which is most of a TRNC lawyer's work.
  ok('4b the inbox names the actual unit, not a placeholder', mineA[0].deal?.title?.includes(TAG) && mineA[0].deal.title.includes('A-1'), JSON.stringify(mineA[0].deal?.title));

  const inboxC = await expectFail('GET', '/legal/engagements', { token: buyer });
  ok('4c the lawyer inbox is not readable by a client', inboxC === 403, `status ${inboxC}`);

  const engagementA = mineA[0].id;
  const inboxB = (await req('GET', '/legal/engagements', { token: lawyerB })).filter((e) => e.dealId === dealId);
  const engagementB = inboxB[0].id;

  const acceptTooEarly = await expectFail('POST', `/legal/engagements/${engagementA}/accept`, { token: buyer });
  ok('4d a request that has not been quoted cannot be accepted', acceptTooEarly === 400, `status ${acceptTooEarly}`);

  await req('POST', `/legal/engagements/${engagementA}/quote`, {
    token: lawyerA,
    body: { amount: 1200, currency: 'GBP', note: 'Includes the permit application.' },
  });
  await req('POST', `/legal/engagements/${engagementB}/quote`, {
    token: lawyerB,
    body: { amount: 1850, currency: 'GBP' },
  });

  const seen = await req('GET', `/deals/${dealId}/legal/engagements`, { token: buyer });
  ok('4e the client sees both quotes', seen.length === 2 && seen.every((e) => e.status === 'quoted'), JSON.stringify(seen.map((e) => [e.lawyerName, e.quoteAmount])));
  ok('4f with the figures quoted', seen.find((e) => e.id === engagementA)?.quoteAmount === 1200, `${seen.find((e) => e.id === engagementA)?.quoteAmount}`);

  const notesBefore = await req('GET', '/users/me/notifications', { token: buyer });
  ok('4g the client was told a quote arrived', notesBefore.some((n) => n.templateKey === 'legal.quote_received'), notesBefore.map((n) => n.templateKey).join(','));

  const beforeRoom = await expectFail('GET', `/deals/${dealId}`, { token: lawyerA });
  ok('4h a lawyer cannot open the deal room before being accepted', beforeRoom === 403, `status ${beforeRoom}`);

  await req('POST', `/legal/engagements/${engagementA}/accept`, { token: buyer });

  const room = await req('GET', `/deals/${dealId}`, { token: lawyerA });
  ok('4i accepting puts the lawyer in the deal room', room.id === dealId);
  ok('4j and records them as a party with the lawyer role', room.myPartyRole === 'lawyer', `${room.myPartyRole}`);
  ok('4k the room lists them alongside buyer and seller', room.parties.some((p) => p.partyRole === 'lawyer'), room.parties.map((p) => p.partyRole).join(','));

  // Cross-checked against the deal's own conversation id rather than trusting
  // that the lawyer's only thread is the right one.
  const dealConvoId = (await req('GET', `/deals/${dealId}`, { token: buyer })).conversations[0]?.id;
  const convos = await req('GET', '/users/me/conversations', { token: lawyerA });
  const inRoom = convos.find((c) => c.id === dealConvoId);
  ok('4l the lawyer is in the deal room conversation', !!inRoom, `${convos.length} conversations, deal convo ${dealConvoId}`);
  ok('4m and joins it on the side that engaged them', inRoom?.myRole === 'lawyer', inRoom?.myRole);

  const afterAccept = await req('GET', `/deals/${dealId}/legal/engagements`, { token: buyer });
  const accepted = afterAccept.find((e) => e.id === engagementA);
  const closed = afterAccept.find((e) => e.id === engagementB);
  ok('4n the accepted engagement is accepted', accepted?.status === 'accepted', accepted?.status);
  ok('4o the other open request is closed, not left hanging', closed?.status === 'withdrawn', closed?.status);

  const notesB = await req('GET', '/users/me/notifications', { token: lawyerB });
  ok('4p the lawyer who lost the work is told', notesB.some((n) => n.templateKey === 'legal.request_withdrawn'), notesB.map((n) => n.templateKey).join(','));
  const notesA = await req('GET', '/users/me/notifications', { token: lawyerA });
  ok('4q the engaged lawyer is told', notesA.some((n) => n.templateKey === 'legal.engagement_accepted'), notesA.map((n) => n.templateKey).join(','));
  const notesDev = await req('GET', '/users/me/notifications', { token: dev });
  ok('4r the other side is told a lawyer joined their deal', notesDev.some((n) => n.templateKey === 'legal.lawyer_joined'), notesDev.map((n) => n.templateKey).join(','));

  const twice = await expectFail('POST', `/legal/engagements/${engagementB}/accept`, { token: buyer });
  ok('4s a second lawyer cannot be engaged by the same party', twice === 400, `status ${twice}`);

  // ── 5. one side's lawyer is not the other's ──────────────────────
  const devView = await req('GET', `/deals/${dealId}/legal/engagements`, { token: dev });
  ok('5a the other side sees none of the buyer’s engagements', devView.length === 0, JSON.stringify(devView.map((e) => e.id)));

  const lawyerView = await req('GET', `/deals/${dealId}/legal/engagements`, { token: lawyerA });
  ok('5b the engaged lawyer sees their own engagement', lawyerView.length === 1 && lawyerView[0].id === engagementA, `${lawyerView.length}`);

  const lawyerEngages = await expectFail('POST', `/deals/${dealId}/legal/requests`, {
    token: lawyerA,
    body: { lawyerUserIds: [lawyerBId] },
  });
  ok('5c a lawyer cannot engage another lawyer on the deal', lawyerEngages === 403, `status ${lawyerEngages}`);

  // ── 6. declining, withdrawing, and what cannot be undone ─────────
  const undo = await expectFail('POST', `/legal/engagements/${engagementA}/withdraw`, { token: buyer });
  ok('6a an accepted engagement cannot be quietly withdrawn', undo === 400, `status ${undo}`);

  const devRequested = await req('POST', `/deals/${dealId}/legal/requests`, {
    token: dev,
    body: { lawyerUserIds: [lawyerBId] },
  });
  ok('6b the seller side can engage their own lawyer independently', devRequested.length === 1);
  const devEngagement = devRequested[0].id;

  await req('POST', `/legal/engagements/${devEngagement}/decline`, { token: lawyerB });
  const declined = (await req('GET', `/deals/${dealId}/legal/engagements`, { token: dev }))[0];
  ok('6c a declined request is recorded as declined', declined.status === 'declined', declined.status);
  const devNotes = await req('GET', '/users/me/notifications', { token: dev });
  ok('6d and the requester is told', devNotes.some((n) => n.templateKey === 'legal.quote_declined'));

  // Re-asking someone who declined reopens the same row rather than failing on
  // the unique key — circumstances change.
  const reask = await req('POST', `/deals/${dealId}/legal/requests`, { token: dev, body: { lawyerUserIds: [lawyerBId] } });
  ok('6e a lawyer who declined can be asked again', reask[0].id === devEngagement && reask[0].status === 'requested', `${reask[0].status}`);

  await req('POST', `/legal/engagements/${devEngagement}/withdraw`, { token: dev });
  const withdrawn = (await req('GET', `/deals/${dealId}/legal/engagements`, { token: dev }))[0];
  ok('6f an open request can be withdrawn', withdrawn.status === 'withdrawn', withdrawn.status);

  const notMine = await expectFail('POST', `/legal/engagements/${engagementA}/decline`, { token: lawyerB });
  ok('6g a lawyer cannot answer another lawyer’s request', notMine === 403, `status ${notMine}`);
  const clientQuotes = await expectFail('POST', `/legal/engagements/${engagementA}/quote`, {
    token: buyer,
    body: { amount: 1, currency: 'GBP' },
  });
  ok('6h a client cannot quote on their own request', clientQuotes === 403, `status ${clientQuotes}`);

  const badCurrency = await expectFail('POST', `/legal/engagements/${devEngagement}/quote`, {
    token: lawyerB,
    body: { amount: 100, currency: 'XYZ' },
  });
  ok('6i an unknown quote currency is refused', badCurrency === 400, `status ${badCurrency}`);

  // ── 7. the §2.2 seam, populated for the first time ───────────────
  const dirAfter = dirHasTag(await req('GET', '/lawyers/directory'));
  const engaged = dirAfter.find((l) => l.userId === lawyerAId);
  ok('7a an accepted engagement counts toward the lawyer’s record', engaged?.engagementCount === 1, `${engaged?.engagementCount}`);
  ok('7b the directory orders by that record', dirAfter[0].userId === lawyerAId, dirAfter.map((l) => `${l.name}:${l.engagementCount}`).join(','));

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL LEGAL-MARKETPLACE E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
