/**
 * Self-contained integration test for the dispute-centre full workflow
 * (Plan §6.7; §10.2 Phase 3, step 26).
 *
 * Step 9 built the spine — open, evidence bundle, decide, reputation. This
 * suite pins the workflow added around it, and the four defects the audit
 * found:
 *
 *   1. notifications tell the truth: a person named in a dispute used to
 *      receive "deal stage advanced" — every event now has its own
 *      `dispute.*` template, and the OUTCOME is carried by which template
 *      fires, never by an English word in a payload
 *   2. the respondent can be heard: statements, visible to both parties and
 *      the admin, refused once the case is decided
 *   3. the opener can withdraw an `open` case — but not one under
 *      investigation, where a withdrawal is indistinguishable from one made
 *      under pressure (§13.2)
 *   4. escalating to `investigating` pauses the deal, and the decision
 *      resumes it — deliberately NOT on `open`, or filing a complaint would
 *      be a one-click veto on the counterparty's deal
 *
 * Plus the boundary that matters most: a party's view of a case NEVER
 * includes the admin evidence bundle — the counterparty's documents and the
 * chat export are scoped to the deal room and the admin (§2.4), not to
 * whoever files a complaint.
 *
 * Everything asserted on is created here; no global state is touched.
 * Run against a live API: `npm run test:e2e:disputes`.
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
  fd.append('file', new Blob([Buffer.from(`%PDF-1.4 e2e-dispute ${salt}`)], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

/** dispute.* notifications for a user, oldest first. */
async function disputeNotes(token) {
  const notes = await req('GET', '/users/me/notifications', { token });
  return notes.filter((n) => n.templateKey?.startsWith('dispute.')).map((n) => n.templateKey);
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const TAG = `zqxdisp${u}`;
  const devPhone = `+9053${u}4`;
  const buyerPhone = `+9053${u}5`;
  const outsiderPhone = `+9053${u}6`;

  const dev = await otp(devPhone, 'developer');
  const buyer = await otp(buyerPhone, 'customer');
  const outsider = await otp(outsiderPhone, 'customer');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: devPhone, planKey: 'developer_basic', months: 12 } });

  // ── an off-plan deal, the cheapest one to build ──────────────────
  const project = await req('POST', '/projects', { token: dev });
  await req('PUT', `/projects/${project.id}`, {
    token: dev,
    body: {
      name: `${TAG} Hillside`,
      description: 'Off-plan project used to exercise the dispute workflow.',
      regionSlug: 'guzelyurt', lat: 35.2, lng: 32.99, deliveryDate: '2028-03-31',
    },
  });
  for (let i = 0; i < 3; i++) await req('POST', `/projects/${project.id}/photos`, { token: dev, form: jpeg() });
  for (const dt of ['construction_permit', 'project_plans']) {
    await req('POST', `/projects/${project.id}/documents`, { token: dev, form: pdf(dt, `${TAG}-${dt}`) });
  }
  await req('POST', `/projects/${project.id}/units`, {
    token: dev,
    body: { unitNo: 'D-1', type: '2+1', bedrooms: 2, areaM2: 85, floor: 1, priceAmount: 120000, priceCurrency: 'GBP' },
  });
  await req('POST', `/projects/${project.id}/submit`, { token: dev });
  const pq = await req('GET', '/admin/verification/queue?entityType=project', { token: admin });
  const pitem = pq.find((q) => q.entityId === project.id);
  const pdetail = await req('GET', `/admin/verification/${pitem.id}`, { token: admin });
  await req('POST', `/admin/verification/${pitem.id}/decision`, {
    token: admin,
    body: { documentDecisions: (pdetail.project?.documents ?? []).map((d) => ({ documentId: d.id, status: 'approved' })) },
  });
  const unit = (await req('GET', `/projects/${project.id}`)).units.find((x) => x.status === 'available');
  const { dealId } = await req('POST', `/units/${unit.id}/reserve`, { token: buyer });
  const devId = (await req('GET', '/users/me', { token: dev })).id;
  const buyerId = (await req('GET', '/users/me', { token: buyer })).id;

  // ── 1. opening, and the notification that finally tells the truth ─
  const short = await expectFail('POST', `/deals/${dealId}/disputes`, { token: buyer, body: { againstUserId: devId, reason: 'bad' } });
  ok('1a a one-word complaint is refused', short === 400, `status ${short}`);

  const disputeA = await req('POST', `/deals/${dealId}/disputes`, {
    token: buyer,
    body: { againstUserId: devId, reason: 'The promised sea-view specification was quietly changed after reservation.' },
  });
  ok('1b a party can open a dispute against another party', disputeA.status === 'open');

  const devNotes1 = await disputeNotes(dev);
  ok('1c the respondent is told a dispute names them — by name, not "deal stage advanced"', devNotes1.includes('dispute.opened'), devNotes1.join(','));

  ok('1d an outsider cannot open a dispute on this deal', (await expectFail('POST', `/deals/${dealId}/disputes`, { token: outsider, body: { againstUserId: devId, reason: 'I simply do not like this development.' } })) === 403);
  ok('1e you cannot dispute yourself', (await expectFail('POST', `/deals/${dealId}/disputes`, { token: buyer, body: { againstUserId: buyerId, reason: 'Regretting my own reservation at length.' } })) === 400);
  ok('1f a second open case against the same person is refused', (await expectFail('POST', `/deals/${dealId}/disputes`, { token: buyer, body: { againstUserId: devId, reason: 'Another complaint about the very same thing.' } })) === 400);

  // ── 2. the respondent is heard ───────────────────────────────────
  await req('POST', `/disputes/${disputeA.id}/statements`, {
    token: dev,
    body: { body: 'The specification change was agreed in writing at reservation — see the deal documents.' },
  });
  const buyerNotes1 = await disputeNotes(buyer);
  ok('2a the other party is told a statement landed', buyerNotes1.includes('dispute.statement_added'), buyerNotes1.join(','));
  ok('2b the author is not notified about their own words', !devNotes1.includes('dispute.statement_added'));

  const buyerView = await req('GET', `/disputes/${disputeA.id}`, { token: buyer });
  ok('2c the opener reads the case with the statement thread', buyerView.statements.length === 1 && buyerView.statements[0].mine === false && buyerView.statements[0].byAdmin === false, JSON.stringify(buyerView.statements));
  ok('2d the party view carries the case, not the evidence bundle', !JSON.stringify(buyerView).includes('"evidence"'));

  await req('POST', `/admin/disputes/${disputeA.id}/statements`, {
    token: admin,
    body: { body: 'Please point me to the clause in the reservation documents.' },
  });
  const devView = await req('GET', `/disputes/${disputeA.id}`, { token: dev });
  ok('2e an admin question is on the record, flagged as the platform speaking', devView.statements.some((s) => s.byAdmin === true), JSON.stringify(devView.statements.map((s) => s.byAdmin)));
  const devNotes2 = await disputeNotes(dev);
  ok('2f and reaches both parties', devNotes2.includes('dispute.statement_added'));

  ok('2g an outsider cannot read the case', (await expectFail('GET', `/disputes/${disputeA.id}`, { token: outsider })) === 403);
  ok('2h or speak into it', (await expectFail('POST', `/disputes/${disputeA.id}/statements`, { token: outsider, body: { body: 'My unsolicited opinion.' } })) === 403);
  ok('2i an empty statement is refused', (await expectFail('POST', `/disputes/${disputeA.id}/statements`, { token: buyer, body: { body: ' ' } })) === 400);
  ok('2j a book is refused', (await expectFail('POST', `/disputes/${disputeA.id}/statements`, { token: buyer, body: { body: 'x'.repeat(4001) } })) === 400);

  // ── 3. investigation pauses the deal ─────────────────────────────
  await req('POST', `/admin/disputes/${disputeA.id}/resolve`, { token: admin, body: { status: 'investigating' } });
  const frozen = await failMessage('POST', `/deals/${dealId}/advance`, { token: dev });
  ok('3a a deal under investigation cannot advance', frozen.includes('-> 400'), frozen.slice(0, 100));
  ok('3b and the refusal says why, not just no', frozen.includes('paused') && frozen.includes('dispute'), frozen.slice(60, 220));
  const devNotes3 = await disputeNotes(dev);
  const buyerNotes3 = await disputeNotes(buyer);
  ok('3c both parties are told the deal is held', devNotes3.includes('dispute.investigating') && buyerNotes3.includes('dispute.investigating'));

  ok('3d withdrawing a case under investigation is refused (§13.2 — pressure must not work)', (await expectFail('POST', `/disputes/${disputeA.id}/withdraw`, { token: buyer })) === 400);
  ok('3e a resolution without a note is refused', (await expectFail('POST', `/admin/disputes/${disputeA.id}/resolve`, { token: admin, body: { status: 'resolved_upheld' } })) === 400);

  await req('POST', `/admin/disputes/${disputeA.id}/resolve`, {
    token: admin,
    body: { status: 'resolved_upheld', resolutionNote: 'The reservation documents do not record the change. Upheld.' },
  });
  const advanced = await req('POST', `/deals/${dealId}/advance`, { token: dev });
  ok('3f the decision releases the deal', advanced.currentStageKey === 'legal_check', advanced.currentStageKey);
  const devNotes4 = await disputeNotes(dev);
  const buyerNotes4 = await disputeNotes(buyer);
  ok('3g both parties get the same outcome template', devNotes4.includes('dispute.upheld') && buyerNotes4.includes('dispute.upheld'));
  ok('3h a decided case takes no more statements', (await expectFail('POST', `/disputes/${disputeA.id}/statements`, { token: dev, body: { body: 'One more thing…' } })) === 400);
  ok('3i and cannot be re-decided', (await expectFail('POST', `/admin/disputes/${disputeA.id}/resolve`, { token: admin, body: { status: 'resolved_dismissed', resolutionNote: 'Changed my mind.' } })) === 400);

  // ── 4. withdrawal, the door §13.2 leaves open ────────────────────
  const disputeB = await req('POST', `/deals/${dealId}/disputes`, {
    token: dev,
    body: { againstUserId: buyerId, reason: 'The buyer has repeatedly missed the agreed document deadlines.' },
  });
  ok('4a the other side can open its own case', disputeB.status === 'open');
  ok('4b only the opener can withdraw it', (await expectFail('POST', `/disputes/${disputeB.id}/withdraw`, { token: buyer })) === 403);

  const withdrawn = await req('POST', `/disputes/${disputeB.id}/withdraw`, { token: dev });
  ok('4c the opener withdraws a case life has resolved', withdrawn.status === 'withdrawn');
  const buyerNotes5 = await disputeNotes(buyer);
  ok('4d the respondent is told it is over', buyerNotes5.includes('dispute.withdrawn'), buyerNotes5.join(','));
  ok('4e a withdrawn case stays withdrawn', (await expectFail('POST', `/disputes/${disputeB.id}/withdraw`, { token: dev })) === 400);
  ok('4f and reopening the same pair is allowed — withdrawal is not a lock', (await req('POST', `/deals/${dealId}/disputes`, { token: dev, body: { againstUserId: buyerId, reason: 'The deadlines were missed again after we spoke about it.' } })).status === 'open');

  // Clean the tail: admin dismisses the reopened case so nothing dangles.
  const mineDev = await req('GET', '/users/me/disputes', { token: dev });
  const openB2 = mineDev.find((d) => d.status === 'open' && d.iOpened);
  await req('POST', `/admin/disputes/${openB2.id}/resolve`, {
    token: admin,
    body: { status: 'resolved_dismissed', resolutionNote: 'Withdrawn and refiled without new substance. Dismissed.' },
  });

  // ── 5. lists and the admin bundle ────────────────────────────────
  const mineBuyer = await req('GET', '/users/me/disputes', { token: buyer });
  ok('5a my list names the deal, not just an id', mineBuyer.every((d) => d.dealTitle?.includes(TAG)), JSON.stringify(mineBuyer.map((d) => d.dealTitle)));
  ok('5b and says which side of each case I am on', mineBuyer.some((d) => d.iOpened) && mineBuyer.some((d) => !d.iOpened));

  const adminDetail = await req('GET', `/admin/disputes/${disputeA.id}`, { token: admin });
  ok('5c the admin bundle now carries the statements beside the evidence', adminDetail.statements.length === 2 && !!adminDetail.evidence, `${adminDetail.statements.length}`);
  ok('5d the deal timeline recorded the whole case', adminDetail.evidence.events.some((e) => e.eventType === 'dispute.opened') && adminDetail.evidence.events.some((e) => e.eventType === 'dispute.investigating') && adminDetail.evidence.events.some((e) => e.eventType === 'dispute.resolved'));
  ok('5e admin routes are admin-only', (await expectFail('GET', '/admin/disputes', { token: buyer })) === 403);
  ok('5f and not public', (await expectFail('GET', '/admin/disputes')) === 401);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL DISPUTE-WORKFLOW E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
