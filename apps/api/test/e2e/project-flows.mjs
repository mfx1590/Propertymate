/**
 * Self-contained integration test for the developer project module (Plan §6.3):
 *   1. register + verify a developer profile
 *   2. create a project, master info, photos, per-project documents, submit
 *   3. admin verification queue (entity_type = project) → approve → live
 *   4. unit inventory: inline CRUD + bulk CSV import + availability grid
 *   5. public discovery: project directory, detail, lead inquiry
 *   6. reservation → off-plan deal (project_purchase pipeline) → completion → unit sold
 *   7. construction progress feed notifies the unit buyer who auto-follows
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:projects`.
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
/** Expect a call to fail — returns the status code. */
async function expectFail(method, path, opts = {}) {
  try {
    await req(method, path, opts);
    return 0;
  } catch (e) {
    return Number(/-> (\d+):/.exec(e.message)?.[1] ?? -1);
  }
}
async function otp(phone, accountType) {
  const r = await req('POST', '/auth/otp/request', { body: { phone } });
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-projects')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const devPhone = `+9055${u}1`;
  const buyerPhone = `+9055${u}2`;

  // ── 1. developer registers and gets its profile verified ─────────
  const dev = await otp(devPhone, 'developer');
  await req('PUT', '/users/me/profile/developer', {
    token: dev,
    body: { companyName: `E2E Developments ${u}`, regNo: `REG-${u}`, taxNo: `TAX-${u}` },
  });
  for (const dt of ['company_registration', 'tax_number']) {
    await req('POST', '/users/me/profile/developer/documents', { token: dev, form: pdf(dt) });
  }
  let queue = await req('GET', '/admin/verification/queue?entityType=profile', { token: admin });
  const profItem = queue.find((q) => q.summary?.lister === devPhone);
  ok('1a developer profile entered the verification queue', !!profItem);
  const profDetail = await req('GET', `/admin/verification/${profItem.id}`, { token: admin });
  await req('POST', `/admin/verification/${profItem.id}/decision`, {
    token: admin,
    body: { documentDecisions: profDetail.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });
  const devRoles = await req('GET', '/users/me/roles', { token: dev });
  ok('1b developer verified after approval', devRoles.find((r) => r.role.key === 'developer')?.verificationStatus === 'verified');

  // ── 2. project creation is subscription-gated (§13.3) ────────────
  const gated = await expectFail('POST', '/projects', { token: dev });
  ok('2a project creation blocked without a subscription', gated === 403, `status ${gated}`);
  await req('POST', '/admin/subscriptions/grant', {
    token: admin,
    body: { identifier: devPhone, planKey: 'developer_basic', months: 12 },
  });

  const project = await req('POST', '/projects', { token: dev });
  await req('PUT', `/projects/${project.id}`, {
    token: dev,
    body: {
      name: `Seaside Residences ${u}`,
      description: 'Off-plan integration-test project on the Kyrenia coast with sea views.',
      regionSlug: 'kyrenia',
      lat: 35.34,
      lng: 33.31,
      deliveryDate: '2028-06-30',
      paymentPlans: [
        { name: '35% down', downPaymentPct: 35, installments: 24, installmentFrequency: 'monthly', onDeliveryPct: 15 },
      ],
    },
  });
  for (let i = 0; i < 3; i++) await req('POST', `/projects/${project.id}/photos`, { token: dev, form: jpeg() });

  // submit is blocked until inventory + required documents exist
  const early = await expectFail('POST', `/projects/${project.id}/submit`, { token: dev });
  ok('2b submit rejected while units and documents are missing', early === 400, `status ${early}`);

  // ── 3. unit inventory: inline create + bulk CSV import ───────────
  await req('POST', `/projects/${project.id}/units`, {
    token: dev,
    body: { unitNo: 'A-101', type: '2+1', bedrooms: 2, areaM2: 95, floor: 1, priceAmount: 145000, priceCurrency: 'GBP' },
  });
  const dupe = await expectFail('POST', `/projects/${project.id}/units`, {
    token: dev,
    body: { unitNo: 'A-101', priceAmount: 1, priceCurrency: 'GBP' },
  });
  ok('3a duplicate unit number rejected', dupe === 400, `status ${dupe}`);

  const csv = [
    'unit_no,type,bedrooms,area_m2,floor,price,currency',
    'A-102,2+1,2,95,1,148000,GBP',
    'A-201,3+1,3,130,2,195000,GBP',
    'A-202,studio,0,48,2,89000,GBP',
    'A-101,2+1,2,95,1,150000,GBP',
    ',broken,,,,,',
    'A-301,3+1,3,130,3,notaprice,GBP',
  ].join('\n');
  const report = await req('POST', `/projects/${project.id}/units/import`, { token: dev, body: { csv } });
  ok('3b CSV import created the new units', report.created === 3, JSON.stringify(report));
  ok('3c CSV import updated the existing unit in place', report.updated === 1);
  ok('3d CSV import reported bad rows instead of failing', report.skipped.length === 2, JSON.stringify(report.skipped));

  const unitsOwned = await req('GET', `/projects/${project.id}/units`, { token: dev });
  ok('3e inventory holds 4 units', unitsOwned.length === 4, `got ${unitsOwned.length}`);
  ok('3f re-import corrected the A-101 price', Number(unitsOwned.find((x) => x.unitNo === 'A-101').priceAmount) === 150000);
  ok('3g studio row imported with 0 bedrooms', unitsOwned.find((x) => x.unitNo === 'A-202')?.bedrooms === 0);

  // ── 4. verification of the project itself ────────────────────────
  for (const dt of ['construction_permit', 'project_plans']) {
    await req('POST', `/projects/${project.id}/documents`, { token: dev, form: pdf(dt) });
  }
  await req('POST', `/projects/${project.id}/submit`, { token: dev });
  ok('4a project not public while pending', (await expectFail('GET', `/projects/${project.id}`)) === 404);

  queue = await req('GET', '/admin/verification/queue?entityType=project', { token: admin });
  const projItem = queue.find((q) => q.entityId === project.id);
  ok('4b admin queue shows the pending project', !!projItem, `queue depth ${queue.length}`);
  const projDetail = await req('GET', `/admin/verification/${projItem.id}`, { token: admin });
  ok('4c review screen serves signed document URLs', projDetail.project.documents.every((d) => !!d.signedUrl));
  ok('4d review screen lists the per-project requirements', projDetail.project.requirements.length >= 2);
  await req('POST', `/admin/verification/${projItem.id}/decision`, {
    token: admin,
    body: { documentDecisions: projDetail.project.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });

  const mine = await req('GET', '/projects/mine', { token: dev });
  ok('4e approved project is live', mine.find((p) => p.id === project.id)?.status === 'live');

  // ── 5. public discovery ──────────────────────────────────────────
  const publicDetail = await req('GET', `/projects/${project.id}`);
  ok('5a public project detail is reachable', publicDetail.id === project.id);
  ok('5b availability grid exposes 4 available units', publicDetail.unitStats.available === 4, JSON.stringify(publicDetail.unitStats));
  ok('5c price-from reflects the cheapest available unit', publicDetail.unitStats.priceFrom === 89000);
  ok('5d payment plan is published', Array.isArray(publicDetail.paymentPlans) && publicDetail.paymentPlans[0].downPaymentPct === 35);
  const directory = await req('GET', '/projects?region=kyrenia&minBeds=3');
  ok('5e project appears in the public directory', directory.some((p) => p.id === project.id));

  const buyer = await otp(buyerPhone, 'customer');
  const convo = await req('POST', `/projects/${project.id}/inquire`, {
    token: buyer,
    body: { message: 'Interested in a 3+1 — call me on 0533 111 2233' },
  });
  const leads = await req('GET', `/projects/${project.id}/leads`, { token: dev });
  ok('5f developer sees the inquiry in the lead inbox', leads.inquiries.some((i) => i.conversationId === convo.id));
  ok('5g project inquiry is contact-scrubbed (§2.4)', !leads.inquiries[0].preview?.includes('0533'), leads.inquiries[0].preview ?? '');

  // ── 6. reservation → off-plan deal → completion ──────────────────
  const target = unitsOwned.find((x) => x.unitNo === 'A-201');
  const { dealId } = await req('POST', `/units/${target.id}/reserve`, { token: buyer });
  ok('6a reservation created an off-plan deal', !!dealId);
  const twice = await expectFail('POST', `/units/${target.id}/reserve`, { token: buyer });
  ok('6b a reserved unit cannot be reserved again', twice === 400, `status ${twice}`);

  let deal = await req('GET', `/deals/${dealId}`, { token: buyer });
  ok('6c deal runs the project_purchase pipeline', deal.stageDefs[0].key === 'reservation' && deal.stageDefs.some((s) => s.key === 'construction'));
  ok('6d deal opens at the reservation stage', deal.currentStageKey === 'reservation');
  ok('6e snapshot froze the unit price', Number(deal.snapshot.priceAgreed) === 195000);
  const grid = await req('GET', `/projects/${project.id}`);
  ok('6f availability grid now shows the unit reserved', grid.units.find((x) => x.id === target.id).status === 'reserved');
  ok('6g public grid never exposes who holds a unit', !JSON.stringify(grid.units).includes('customerId'));

  await req('POST', `/deals/${dealId}/advance`, { token: dev });   // reservation → legal_check
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // legal_check → contract_signing
  await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('contract') });
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // contract_signing → deposit_recorded
  await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('deposit_receipt') });
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // deposit → permit_process
  await req('POST', `/deals/${dealId}/skip`, { token: buyer });    // skip permit → construction

  // ── 7. progress feed reaches the auto-following buyer ────────────
  const before = (await req('GET', '/users/me/notifications', { token: buyer })).length;
  const update = await req('POST', `/projects/${project.id}/updates`, {
    token: dev,
    body: { title: 'Foundations poured', body: 'Block A foundations completed this week.' },
  });
  ok('7a update notified the unit buyer who auto-follows', update.notified >= 1, `notified ${update.notified}`);
  const after = (await req('GET', '/users/me/notifications', { token: buyer })).length;
  ok('7b buyer received the progress notification', after > before, `${before} → ${after}`);
  const feed = await req('GET', `/projects/${project.id}/updates`);
  ok('7c progress feed is public on the project page', feed.some((f) => f.id === update.id));

  await req('POST', `/deals/${dealId}/advance`, { token: dev });   // construction → completion
  deal = await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // completion
  ok('7d off-plan deal completed', deal.status === 'completed');
  const sold = await req('GET', `/projects/${project.id}`);
  ok('7e completed deal marked the unit sold', sold.units.find((x) => x.id === target.id).status === 'sold');
  ok('7f availability roll-up updated', sold.unitStats.sold === 1 && sold.unitStats.available === 3, JSON.stringify(sold.unitStats));

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL PROJECT-MODULE E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
