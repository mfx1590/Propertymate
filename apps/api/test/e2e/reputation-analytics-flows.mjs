/**
 * Self-contained integration test for reputation ranking + analytics
 * (Plan §6.5 ranking score, §8 ranking order, §6.7 and §13.1 dashboards):
 *   1. a fresh professional scores a neutral baseline; factors sum to the score
 *   2. chat activity produces a real response time; a completed deal + revealed
 *      rating raise the score
 *   3. the find-my-agent directory is ordered by ranking score
 *   4. search documents carry the §8 ranking inputs, and a score change
 *      re-indexes that lister's listings
 *   5. the trusted_partner badge holds below the §3 threshold
 *   6. /analytics/me returns the caller's funnel, reputation and org rollup
 *   7. developer project comparison reports mine-vs-market without naming rivals
 *   8. analytics scope cannot be widened: no subject id, and admin numbers
 *      stay behind analytics.view
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:reputation`.
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

/**
 * OTP sends are capped at 5/min per IP (§2.4) and this suite needs five actors.
 * The cap is a rolling window shared with anything else hitting the API, so
 * rather than count locally, back off on the 429 the server actually returns —
 * that also lets the suite run straight after another one in CI.
 */
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
/** Smallest valid JPEG the sharp pipeline will accept. */
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-rep')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function retry(fn, check, tries = 10, gap = 500) {
  for (let i = 0; i < tries; i++) {
    const r = await fn().catch(() => null);
    if (r && check(r)) return r;
    await sleep(gap);
  }
  return fn();
}

/** Approves every document on the caller's queued verification item. */
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
  return item;
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
  const agentPhone = `+9053${u}1`;
  const agencyPhone = `+9053${u}2`;
  const ownerPhone = `+9053${u}3`;
  const buyerPhone = `+9053${u}4`;
  const devPhone = `+9053${u}5`;
  const memberPhone = `+9053${u}6`; // added by phone — never needs an OTP send

  // ── 1. two verified professionals ────────────────────────────────
  const agent = await otp(agentPhone, 'solo_agent');
  for (const dt of ['government_id', 'real_estate_license', 'selfie_with_id']) {
    await req('POST', '/users/me/profile/solo_agent/documents', { token: agent, form: jpeg(dt) });
  }
  await approve(admin, (q) => q.summary?.lister === agentPhone, 'profile');
  const agentId = (await req('GET', '/users/me', { token: agent })).id;

  const agency = await otp(agencyPhone, 'agency');
  await req('PUT', '/users/me/profile/agency', {
    token: agency,
    body: { companyName: `Rank Realty ${u}`, regNo: `REG-${u}`, taxNo: `TAX-${u}` },
  });
  for (const dt of ['company_registration', 'tax_number']) {
    await req('POST', '/users/me/profile/agency/documents', { token: agency, form: pdf(dt) });
  }
  await approve(admin, (q) => q.summary?.lister === agencyPhone, 'profile');
  const agencyId = (await req('GET', '/users/me', { token: agency })).id;

  // the directory is an owner-facing tool (`listing.delegate`), so the owner
  // has to exist before anything can read it
  const owner = await otp(ownerPhone, 'owner');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });

  // baseline scores: nobody has traded yet
  await req('POST', '/admin/jobs/reputation', { token: admin });
  let dir = await req('GET', '/agents/directory', { token: owner });
  const freshEntry = dir.find((a) => a.userId === agentId);
  ok('1a a fresh professional is scored', typeof freshEntry?.rankingScore === 'number', `score ${freshEntry?.rankingScore}`);
  ok(
    '1b baseline sits mid-scale — no history is neither good nor bad',
    freshEntry.rankingScore > 40 && freshEntry.rankingScore < 65,
    `score ${freshEntry.rankingScore}`,
  );
  ok('1c fresh professional has no deals counted', freshEntry.dealCount === 0);

  // ── 2. an owner publishes through the agent (find-my-agent) ──────
  async function publishThroughAgent(title) {
    const p = await req('POST', '/properties', { token: owner, body: { kind: 'resale' } });
    await req('PUT', `/properties/${p.id}`, {
      token: owner,
      body: {
        title,
        description:
          'A generously specified sea-view villa used to prove the completeness component of the ranking score. ' +
          'It carries a full description, coordinates, area, bed and bath counts and a feature list, which is ' +
          'exactly what the §8 completeness score rewards over a bare listing with five photos and one line.',
        regionSlug: 'kyrenia', district: 'Alsancak', lat: 35.34, lng: 33.32,
        priceAmount: 200000, priceCurrency: 'GBP', bedrooms: 3, bathrooms: 2, areaM2: 160,
        deedType: 'turkish', furnished: true,
        features: ['pool', 'sea_view', 'parking', 'garden', 'air_conditioning'],
      },
    });
    for (let i = 0; i < 6; i++) await req('POST', `/properties/${p.id}/photos`, { token: owner, form: jpeg() });
    for (const dt of ['title_deed', 'owner_id', 'utility_bill']) {
      await req('POST', `/properties/${p.id}/documents`, { token: owner, form: pdf(dt) });
    }
    await req('POST', `/properties/${p.id}/submit`, { token: owner });
    await approve(admin, (q) => q.entityId === p.id, 'listing');

    await req('POST', `/properties/${p.id}/assignments`, { token: owner, body: { agentUserIds: [agentId], termMonths: 3 } });
    const assignment = (await req('GET', '/users/me/assignments', { token: agent })).find((x) => x.propertyId === p.id);
    await req('POST', `/assignments/${assignment.id}/respond`, { token: agent, body: { action: 'accept' } });
    await req('POST', `/assignments/${assignment.id}/publish`, { token: agent, body: { commissionGbp: 6000 } });
    return p;
  }

  const draft = await publishThroughAgent(`Ranking villa ${u}`);
  // a second listing by the same agent: the first one sells below, and a sold
  // listing leaves the index — this one stays live to prove the re-index path
  const stayLive = await publishThroughAgent(`Ranking apartment ${u}`);

  // ── 3. §8 ranking inputs land in the search index ────────────────
  const indexed = await retry(
    () => req('GET', '/search/listings?region=kyrenia'),
    (r) => (r.hits ?? []).some((h) => h.id === draft.id),
  );
  const hit = indexed.hits.find((h) => h.id === draft.id);
  ok('3a indexed document carries the lister ranking score', hit.listerScore === freshEntry.rankingScore, `doc ${hit.listerScore} vs profile ${freshEntry.rankingScore}`);
  ok('3b a brand-new listing is in the freshest tier', hit.freshnessTier === 2, `tier ${hit.freshnessTier}`);
  ok(
    '3c a complete listing scores high on completeness',
    hit.completenessScore >= 80,
    `completeness ${hit.completenessScore}`,
  );

  // ── 4. chat → viewing → offer → completed deal ───────────────────
  const buyer = await otp(buyerPhone, 'customer');
  const buyerId = (await req('GET', '/users/me', { token: buyer })).id;
  const convo = await req('POST', `/properties/${draft.id}/inquire`, { token: buyer, body: { message: 'Is this still available?' } });
  await req('POST', `/conversations/${convo.id}/messages`, { token: agent, body: { message: 'Yes — happy to arrange a viewing.' } });

  const when = new Date(Date.now() + 86_400_000).toISOString();
  const viewing = await req('POST', `/properties/${draft.id}/viewings`, { token: buyer, body: { scheduledAt: when } });
  await req('PUT', `/viewings/${viewing.id}/status`, { token: agent, body: { status: 'confirmed' } });

  const offer = await req('POST', `/properties/${draft.id}/offers`, { token: buyer, body: { amount: 210000, currency: 'GBP' } });
  const { dealId } = await req('POST', `/offers/${offer.id}/respond`, { token: agent, body: { action: 'accept' } });
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // legal_check → contract_signing
  await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('contract') });
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // contract_signing → deposit
  await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('deposit_receipt') });
  await req('POST', `/deals/${dealId}/advance`, { token: buyer }); // deposit → permit_process
  await req('POST', `/deals/${dealId}/skip`, { token: buyer });    // skip permit → completion
  const completed = await req('POST', `/deals/${dealId}/advance`, { token: buyer });
  ok('4a deal completed', completed.status === 'completed');

  await req('POST', `/deals/${dealId}/ratings`, { token: buyer, body: { rateeId: agentId, stars: 5, tags: ['responsive'] } });
  await req('POST', `/deals/${dealId}/ratings`, { token: agent, body: { rateeId: buyerId, stars: 5, tags: ['honest'] } });

  // ── 5. the score moves, and moves the directory with it ──────────
  await req('POST', '/admin/jobs/reputation', { token: admin });
  dir = await req('GET', '/agents/directory', { token: owner });
  const scored = dir.find((a) => a.userId === agentId);
  ok('5a a completed 5★ deal raised the score', scored.rankingScore > freshEntry.rankingScore, `${freshEntry.rankingScore} → ${scored.rankingScore}`);
  ok('5b the deal is counted', scored.dealCount === 1, `dealCount ${scored.dealCount}`);
  ok('5c a real response time was measured from chat', typeof scored.responseTimeAvgSec === 'number', `${scored.responseTimeAvgSec}`);

  const agentPos = dir.findIndex((a) => a.userId === agentId);
  const agencyPos = dir.findIndex((a) => a.userId === agencyId);
  ok('5d directory is ordered by ranking score', agentPos < agencyPos, `agent #${agentPos}, untraded agency #${agencyPos}`);
  ok('5e directory never leaks contact details', !JSON.stringify(dir).includes(agentPhone));

  // one completed deal is well short of the §3 threshold
  const badge = (await req('GET', '/users/me/roles', { token: agent })).find((r) => r.role.key === 'solo_agent');
  ok('5f trusted_partner withheld below 5 completed deals', badge.badgeTier === 'verified', `tier ${badge.badgeTier}`);

  // the new score must reach the index, not just the profile
  const reindexed = await retry(
    () => req('GET', '/search/listings?region=kyrenia'),
    (r) => (r.hits ?? []).find((h) => h.id === stayLive.id)?.listerScore === scored.rankingScore,
  );
  const liveHit = reindexed.hits.find((h) => h.id === stayLive.id);
  ok(
    '5g score change re-indexed the lister live listings',
    liveHit?.listerScore === scored.rankingScore,
    `doc ${liveHit?.listerScore} vs ${scored.rankingScore}`,
  );
  ok(
    '5h the sold listing left the index',
    !reindexed.hits.some((h) => h.id === draft.id),
  );

  // ── 6. the agent's own dashboard ─────────────────────────────────
  await req('GET', `/properties/${draft.id}`, { token: buyer }); // a view worth counting
  const mine = await retry(
    () => req('GET', '/analytics/me', { token: agent }),
    (r) => r.funnel.viewsRecent > 0,
  );
  // exactly one inquiry: the buyer's. The owner↔agent mediation channel on
  // each of the two listings is not a lead and must not inflate the funnel.
  ok('6a funnel counts real leads only', mine.funnel.inquiries === 1 && mine.funnel.offers === 1, JSON.stringify(mine.funnel));
  ok('6a2 both of the agent listings are in scope', (mine.listings.sold ?? 0) === 1 && (mine.listings.live ?? 0) === 1, JSON.stringify(mine.listings));
  ok('6b view events feed the recent window', mine.funnel.viewsRecent >= 1, `${mine.funnel.viewsRecent}`);
  ok('6c completed deal recorded as a closed sale', mine.deals.salesClosed === 1, JSON.stringify(mine.deals));
  ok('6d conversion rates are computed server-side', typeof mine.funnel.closeRate === 'number');

  const rep = mine.reputation;
  const summed = Object.values(rep.factors).reduce((s, f) => s + f.score * f.weight, 0);
  ok('6e dashboard explains the score it ranks on', Math.abs(summed - rep.score) < 0.11, `sum ${summed.toFixed(2)} vs ${rep.score}`);
  ok(
    '6f all four §6.5 factors are reported',
    ['deals', 'disputeFree', 'rating', 'responseTime'].every((k) => k in rep.factors),
    Object.keys(rep.factors).join(','),
  );
  ok('6g stored nightly score matches the live breakdown', Math.abs(rep.storedScore - rep.score) < 0.11, `${rep.storedScore} vs ${rep.score}`);

  const ownerView = await req('GET', '/analytics/me', { token: owner });
  ok('6h an owner sees their own listing funnel', ownerView.funnel.offers >= 1, JSON.stringify(ownerView.funnel));

  // ── 7. agency org rollup (§13.1) ─────────────────────────────────
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: agencyPhone, planKey: 'agency_basic', months: 12 } });
  await req('POST', '/agency/members', { token: agency, body: { phone: memberPhone, regions: ['kyrenia'] } });
  const orgView = await req('GET', '/analytics/me', { token: agency });
  ok('7a agency dashboard is org-scoped', orgView.scope.isOrg === true);
  ok('7b members roll up individually', Array.isArray(orgView.members) && orgView.members.length === 1, `${orgView.members?.length}`);
  ok('7c solo agent gets no members block', !('members' in mine));

  // ── 8. developer project comparison (§13.1b) ─────────────────────
  const dev = await otp(devPhone, 'developer');
  await req('PUT', '/users/me/profile/developer', {
    token: dev,
    body: { companyName: `Rank Developments ${u}`, regNo: `DREG-${u}`, taxNo: `DTAX-${u}` },
  });
  for (const dt of ['company_registration', 'tax_number']) {
    await req('POST', '/users/me/profile/developer/documents', { token: dev, form: pdf(dt) });
  }
  await approve(admin, (q) => q.summary?.lister === devPhone, 'profile');
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: devPhone, planKey: 'developer_basic', months: 12 } });

  const project = await req('POST', '/projects', { token: dev });
  await req('PUT', `/projects/${project.id}`, {
    token: dev,
    body: {
      name: `Rank Residences ${u}`,
      description: 'Off-plan project used to exercise the §13.1b developer comparison analytics.',
      regionSlug: 'iskele', lat: 35.28, lng: 33.89, deliveryDate: '2028-06-30',
      paymentPlans: [{ name: '30% down', downPaymentPct: 30, installments: 24, installmentFrequency: 'monthly', onDeliveryPct: 20 }],
    },
  });
  for (let i = 0; i < 3; i++) await req('POST', `/projects/${project.id}/photos`, { token: dev, form: jpeg() });
  for (const unit of [
    { unitNo: 'B-101', bedrooms: 2, areaM2: 100, priceAmount: 120000 },
    { unitNo: 'B-102', bedrooms: 3, areaM2: 150, priceAmount: 180000 },
  ]) {
    await req('POST', `/projects/${project.id}/units`, { token: dev, body: { ...unit, type: `${unit.bedrooms}+1`, floor: 1, priceCurrency: 'GBP' } });
  }
  for (const dt of ['construction_permit', 'project_plans']) {
    await req('POST', `/projects/${project.id}/documents`, { token: dev, form: pdf(dt) });
  }
  await req('POST', `/projects/${project.id}/submit`, { token: dev });
  await approve(admin, (q) => q.entityId === project.id, 'project');

  const devView = await req('GET', '/analytics/me', { token: dev });
  ok('8a developer dashboard lists per-project inventory', devView.projects?.[0]?.units.total === 2, JSON.stringify(devView.projects?.[0]?.units));
  ok('8b absorption rate reported', devView.projects[0].absorptionRate === 0, `${devView.projects[0].absorptionRate}`);
  ok('8c avg price/m² computed (1200 both units)', devView.projects[0].avgPricePerM2 === 1200, `${devView.projects[0].avgPricePerM2}`);

  const cmp = await req('GET', '/analytics/projects/comparison', { token: dev });
  const iskele = cmp.byRegion.find((r) => r.regionSlug === 'iskele');
  ok('8d comparison covers the region the developer builds in', !!iskele);
  ok('8e mine-vs-market benchmarks are present', iskele.mine.projects === 1 && iskele.market.projects >= 1);
  ok('8f overall market benchmark spans all regions', cmp.overall.market.projects >= cmp.overall.mine.projects);
  ok('8g comparison names no rival project or developer', !JSON.stringify(cmp).includes('projectId') && !JSON.stringify(cmp).includes('developer'));

  // ── 9. scope cannot be widened ───────────────────────────────────
  ok('9a a customer has no analytics permission', (await expectFail('GET', '/analytics/me', { token: buyer })) === 403);
  ok('9b platform analytics are admin-only', (await expectFail('GET', '/analytics/admin/overview', { token: agent })) === 403);
  ok('9c analytics endpoints are not public', (await expectFail('GET', '/analytics/me')) === 401);

  const platform = await req('GET', '/analytics/admin/overview', { token: admin });
  ok('9d admin sees supply by region', !!platform.supplyByRegion.kyrenia, JSON.stringify(Object.keys(platform.supplyByRegion)));
  ok('9e admin sees the market funnel', platform.funnel.offers >= 1, JSON.stringify(platform.funnel));
  ok('9f admin sees verification SLA performance', typeof platform.verification.avgTurnaroundHours === 'number' && platform.verification.withinSlaPct !== null);

  // Put the platform back how we found it. These suites run against dev
  // databases as well as CI's throwaway one, and silently leaving a disabled
  // feature switched on is a nasty surprise for whoever looks next.
  await restoreOffers();

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL REPUTATION + ANALYTICS E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  await restoreOffers();
  console.error('E2E ERROR:', e.message);
  process.exit(1);
});
