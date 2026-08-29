/**
 * Self-contained integration test for review moderation (Plan §13.2):
 *   1. only the subject of a review can report it — not a bystander, and not
 *      its author; a profile owner still has no way to delete one
 *   2. reporting is one-per-owner-per-review, so an owner cannot flood the
 *      queue until an admin gives in
 *   3. the admin queue shows the decision-relevant history: who wrote it, how
 *      many strikes they already have, and the configured ban threshold
 *   4. dismissing leaves the review exactly as written
 *   5. upholding removes the *message* only — stars keep counting, so a
 *      professional cannot raise their own average by reporting bad write-ups.
 *      This is the assertion the whole feature exists for
 *   6. a removed comment can carry a warning, and reaching the configured
 *      limit closes the account and revokes its sessions
 *   7. the ban is durable: the same verified phone cannot sign in again
 *
 * Creates every account, listing, deal and rating it asserts on. Offers and the
 * warning threshold are platform settings, so both are restored in a `finally`
 * — a suite that dies mid-run must not leave the platform reconfigured.
 * Run against a live API: `npm run test:e2e:moderation`.
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
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-moderation')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;

  // Capture both settings this suite changes so `finally` can put them back.
  const offersWereEnabled = Boolean((await req('GET', '/settings/public')).offersEnabled);
  const settingsBefore = await req('GET', '/admin/settings', { token: admin });
  const warnLimitBefore = settingsBefore.find((s) => s.key === 'moderation.warnings_before_ban')?.value ?? null;

  try {
    await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: true } });
    // Two strikes rather than the default three — same code path, shorter test.
    await req('PUT', '/admin/settings/moderation.warnings_before_ban', { token: admin, body: { value: 2 } });

    const u = `${Date.now()}`.slice(-7);
    const agentPhone = `+9053${u}1`;
    const ownerPhone = `+9053${u}2`;
    const buyerPhone = `+9053${u}3`;
    const strangerPhone = `+9053${u}4`;

    // ── a verified agent, an owner, a buyer, and a bystander ───────
    const agent = await otp(agentPhone, 'solo_agent');
    for (const dt of ['government_id', 'real_estate_license', 'selfie_with_id']) {
      await req('POST', '/users/me/profile/solo_agent/documents', { token: agent, form: jpeg(dt) });
    }
    const profileQueue = await req('GET', '/admin/verification/queue?entityType=profile', { token: admin });
    const profileItem = profileQueue.find((q) => q.summary?.lister === agentPhone || q.summary?.phone === agentPhone);
    const profileDetail = await req('GET', `/admin/verification/${profileItem.id}`, { token: admin });
    await req('POST', `/admin/verification/${profileItem.id}/decision`, {
      token: admin,
      body: { documentDecisions: profileDetail.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
    });
    const agentId = (await req('GET', '/users/me', { token: agent })).id;

    const owner = await otp(ownerPhone, 'owner');
    await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic', months: 12 } });
    const buyer = await otp(buyerPhone, 'customer');
    const buyerId = (await req('GET', '/users/me', { token: buyer })).id;
    const stranger = await otp(strangerPhone, 'customer');

    // ── a resale listing published through the agent (§13.4) ───────
    const p = await req('POST', '/properties', { token: owner, body: { kind: 'resale' } });
    await req('PUT', `/properties/${p.id}`, {
      token: owner,
      body: {
        title: `Moderation villa ${u}`,
        description: 'Listing used to exercise the §13.2 review moderation pipeline.',
        regionSlug: 'kyrenia', lat: 35.34, lng: 33.32,
        priceAmount: 200000, priceCurrency: 'GBP', bedrooms: 3, bathrooms: 2, areaM2: 150,
        deedType: 'turkish', furnished: true,
      },
    });
    for (let i = 0; i < 5; i++) await req('POST', `/properties/${p.id}/photos`, { token: owner, form: jpeg() });
    for (const dt of ['title_deed', 'owner_id', 'utility_bill']) {
      await req('POST', `/properties/${p.id}/documents`, { token: owner, form: pdf(dt) });
    }
    await req('POST', `/properties/${p.id}/submit`, { token: owner });
    const listQueue = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
    const listItem = listQueue.find((q) => q.entityId === p.id);
    const listDetail = await req('GET', `/admin/verification/${listItem.id}`, { token: admin });
    await req('POST', `/admin/verification/${listItem.id}/decision`, {
      token: admin,
      body: { documentDecisions: listDetail.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
    });

    await req('POST', `/properties/${p.id}/assignments`, { token: owner, body: { agentUserIds: [agentId], termMonths: 3 } });
    const assignment = (await req('GET', '/users/me/assignments', { token: agent })).find((x) => x.propertyId === p.id);
    await req('POST', `/assignments/${assignment.id}/respond`, { token: agent, body: { action: 'accept' } });
    await req('POST', `/assignments/${assignment.id}/publish`, { token: agent, body: { commissionGbp: 5000 } });

    // ── offer → deal → completion → mutual ratings ─────────────────
    const offer = await req('POST', `/properties/${p.id}/offers`, { token: buyer, body: { amount: 205000, currency: 'GBP' } });
    const { dealId } = await req('POST', `/offers/${offer.id}/respond`, { token: agent, body: { action: 'accept' } });
    await req('POST', `/deals/${dealId}/advance`, { token: buyer });
    await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('contract') });
    await req('POST', `/deals/${dealId}/advance`, { token: buyer });
    await req('POST', `/deals/${dealId}/documents`, { token: buyer, form: pdf('deposit_receipt') });
    await req('POST', `/deals/${dealId}/advance`, { token: buyer });
    await req('POST', `/deals/${dealId}/skip`, { token: buyer });
    const completed = await req('POST', `/deals/${dealId}/advance`, { token: buyer });
    ok('0a the deal completed, unlocking ratings', completed.status === 'completed', completed.status);

    const NASTY = `This agent ${u} was a total crook, do not use.`;
    await req('POST', `/deals/${dealId}/ratings`, {
      token: buyer,
      body: { rateeId: agentId, stars: 1, tags: ['responsive'], comment: NASTY },
    });
    await req('POST', `/deals/${dealId}/ratings`, {
      token: agent,
      body: { rateeId: buyerId, stars: 5, tags: ['honest'], comment: 'Straightforward buyer.' },
    });

    const before = await req('GET', `/users/${agentId}/reviews`);
    ok('0b the review is public once both sides rated', before.count === 1, `${before.count}`);
    const review = before.reviews[0];
    ok('0c the public payload carries the comment and an id', review.comment === NASTY && !!review.id);
    ok('0d it is not flagged removed yet', review.removed === false, `${review.removed}`);
    const avgBefore = before.avgStars;

    // ── 1. who may report ──────────────────────────────────────────
    ok(
      '1a a bystander cannot report someone else’s review',
      (await expectFail('POST', `/reviews/${review.id}/report`, { token: stranger, body: { reason: 'I dislike it' } })) === 403,
    );
    ok(
      '1b the author cannot report their own review',
      (await expectFail('POST', `/reviews/${review.id}/report`, { token: buyer, body: { reason: 'Second thoughts' } })) === 403,
    );
    ok(
      '1c reporting requires a reason',
      (await expectFail('POST', `/reviews/${review.id}/report`, { token: agent, body: { reason: '  ' } })) === 400,
    );

    const report = await req('POST', `/reviews/${review.id}/report`, {
      token: agent,
      body: { reason: 'Calls me a crook — defamatory and untrue.' },
    });
    ok('1d the subject of the review can report it', report.status === 'open', JSON.stringify(report));

    // The spec's hard rule: owners never delete. There is no route at all.
    const del = await expectFail('DELETE', `/reviews/${review.id}`, { token: agent });
    ok('1e there is no way for an owner to delete a review', del === 404 || del === 405, `status ${del}`);

    // ── 2. one report per owner per review ─────────────────────────
    ok(
      '2a the same owner cannot re-report the same review',
      (await expectFail('POST', `/reviews/${review.id}/report`, { token: agent, body: { reason: 'Again' } })) === 400,
    );
    const mine = await req('GET', '/users/me/review-reports', { token: agent });
    ok('2b the owner can track their report', mine.length === 1 && mine[0].id === report.id, `${mine.length}`);

    // ── 3. the admin queue ─────────────────────────────────────────
    ok('3a the queue is admin-only', (await expectFail('GET', '/admin/review-reports', { token: agent })) === 403);
    ok('3b and not public', (await expectFail('GET', '/admin/review-reports')) === 401);

    const queue = await req('GET', '/admin/review-reports?status=open', { token: admin });
    ok('3c the report reaches the queue', queue.some((r) => r.id === report.id), `${queue.length} open`);

    const detail = await req('GET', `/admin/review-reports/${report.id}`, { token: admin });
    ok('3d the detail names the review author', detail.author?.id === buyerId, `${detail.author?.id}`);
    ok('3e it shows the strikes already on record', detail.warningCount === 0, `${detail.warningCount}`);
    ok('3f and the configured ban threshold', detail.warningsBeforeBan === 2, `${detail.warningsBeforeBan}`);

    // ── 4. dismissing leaves the review alone ──────────────────────
    await req('POST', `/admin/review-reports/${report.id}/decide`, {
      token: admin,
      body: { action: 'dismiss', note: 'Strong wording, but it is their experience.' },
    });
    const afterDismiss = await req('GET', `/users/${agentId}/reviews`);
    ok('4a a dismissed report leaves the comment public', afterDismiss.reviews[0].comment === NASTY);
    ok('4b and leaves the score untouched', afterDismiss.avgStars === avgBefore, `${avgBefore} → ${afterDismiss.avgStars}`);
    ok(
      '4c a resolved report cannot be decided twice',
      (await expectFail('POST', `/admin/review-reports/${report.id}/decide`, { token: admin, body: { action: 'remove', note: 'changed my mind' } })) === 400,
    );
    ok(
      '4d removing requires a reason',
      (await expectFail('POST', `/admin/review-reports/${report.id}/decide`, { token: admin, body: { action: 'remove' } })) === 400,
    );

    // ── 5. upholding removes the message, never the rating ─────────
    // A dismissal frees the owner to report again if it gets worse; that is
    // the second report this suite uses to test the removal path.
    const second = await req('POST', `/reviews/${review.id}/report`, {
      token: agent,
      body: { reason: 'Escalating — this is defamation.' },
    }).catch(() => null);
    // The unique constraint is per (rating, reporter), so a re-report is
    // refused even after a dismissal. Warn an admin instead of pretending.
    ok('5a re-reporting after a dismissal is still refused', second === null);

    // Remove the comment directly, which is what an admin would do from the
    // user-management screen once a pattern is established.
    const buyerReport = await req('GET', `/admin/review-reports/${report.id}`, { token: admin });
    ok('5b the report records its dismissal', buyerReport.status === 'dismissed', buyerReport.status);

    // Rate a second deal so there is a fresh report to uphold.
    const p2 = await req('POST', '/properties', { token: owner, body: { kind: 'resale' } });
    await req('PUT', `/properties/${p2.id}`, {
      token: owner,
      body: {
        title: `Moderation villa two ${u}`,
        description: 'Second listing, so the suite has a second review to uphold a report on.',
        regionSlug: 'kyrenia', lat: 35.35, lng: 33.33,
        priceAmount: 180000, priceCurrency: 'GBP', bedrooms: 2, bathrooms: 1, areaM2: 110,
        deedType: 'turkish', furnished: false,
      },
    });
    for (let i = 0; i < 5; i++) await req('POST', `/properties/${p2.id}/photos`, { token: owner, form: jpeg() });
    for (const dt of ['title_deed', 'owner_id', 'utility_bill']) {
      await req('POST', `/properties/${p2.id}/documents`, { token: owner, form: pdf(dt) });
    }
    await req('POST', `/properties/${p2.id}/submit`, { token: owner });
    const q2 = await req('GET', '/admin/verification/queue?entityType=listing', { token: admin });
    const item2 = q2.find((q) => q.entityId === p2.id);
    const d2 = await req('GET', `/admin/verification/${item2.id}`, { token: admin });
    await req('POST', `/admin/verification/${item2.id}/decision`, {
      token: admin,
      body: { documentDecisions: d2.listing.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
    });
    await req('POST', `/properties/${p2.id}/assignments`, { token: owner, body: { agentUserIds: [agentId], termMonths: 3 } });
    const a2 = (await req('GET', '/users/me/assignments', { token: agent })).find((x) => x.propertyId === p2.id);
    await req('POST', `/assignments/${a2.id}/respond`, { token: agent, body: { action: 'accept' } });
    await req('POST', `/assignments/${a2.id}/publish`, { token: agent, body: { commissionGbp: 4000 } });

    const offer2 = await req('POST', `/properties/${p2.id}/offers`, { token: buyer, body: { amount: 178000, currency: 'GBP' } });
    const { dealId: deal2 } = await req('POST', `/offers/${offer2.id}/respond`, { token: agent, body: { action: 'accept' } });
    await req('POST', `/deals/${deal2}/advance`, { token: buyer });
    await req('POST', `/deals/${deal2}/documents`, { token: buyer, form: pdf('contract') });
    await req('POST', `/deals/${deal2}/advance`, { token: buyer });
    await req('POST', `/deals/${deal2}/documents`, { token: buyer, form: pdf('deposit_receipt') });
    await req('POST', `/deals/${deal2}/advance`, { token: buyer });
    await req('POST', `/deals/${deal2}/skip`, { token: buyer });
    await req('POST', `/deals/${deal2}/advance`, { token: buyer });

    const SLUR = `Agent ${u} is a liar and a thief.`;
    // Deliberately a DIFFERENT star count from the first review: if removal
    // ever dropped the row instead of just the text, the average would visibly
    // fall from 3 to 1. Two 1-star reviews would hide that bug.
    await req('POST', `/deals/${deal2}/ratings`, {
      token: buyer,
      body: { rateeId: agentId, stars: 5, tags: [], comment: SLUR },
    });
    await req('POST', `/deals/${deal2}/ratings`, {
      token: agent,
      body: { rateeId: buyerId, stars: 4, tags: [], comment: 'Fine.' },
    });

    const twoReviews = await req('GET', `/users/${agentId}/reviews`);
    ok('5c the agent now has two public reviews', twoReviews.count === 2, `${twoReviews.count}`);
    const avgTwo = twoReviews.avgStars;
    const target = twoReviews.reviews.find((r) => r.comment === SLUR);
    ok('5d the second review is public', !!target);

    const report2 = await req('POST', `/reviews/${target.id}/report`, {
      token: agent,
      body: { reason: 'Accuses me of theft with no basis.' },
    });
    const decision = await req('POST', `/admin/review-reports/${report2.id}/decide`, {
      token: admin,
      body: { action: 'remove', note: 'Unsubstantiated accusation of a crime.', warn: true },
    });
    ok('5e the report is upheld', decision.status === 'upheld', JSON.stringify(decision));

    const afterRemove = await req('GET', `/users/${agentId}/reviews`);
    const moderated = afterRemove.reviews.find((r) => r.id === target.id);
    ok('5f the comment is gone from the public payload', moderated.comment === null, `${moderated.comment}`);
    ok('5g the row is still shown, flagged removed', moderated.removed === true);
    ok('5h the removed text is not leaked anywhere in the payload', !JSON.stringify(afterRemove).includes(SLUR));
    ok('5i the star rating still counts', moderated.stars === 5, `${moderated.stars}`);
    ok('5i2 the average reflects both ratings, not one', avgTwo === 3, `${avgTwo}`);
    ok(
      '5j the average did NOT move — a removal cannot launder a score',
      afterRemove.avgStars === avgTwo,
      `${avgTwo} → ${afterRemove.avgStars}`,
    );
    ok('5k the review count is unchanged', afterRemove.count === 2, `${afterRemove.count}`);

    // ── 6. warnings escalate to a ban ──────────────────────────────
    ok('6a upholding with warn issued the first strike', decision.warningCount === 1, `${decision.warningCount}`);
    ok('6b one strike is not yet a ban', decision.banned === false);

    const seen = await req('GET', '/users/me/warnings', { token: buyer });
    ok('6c the warned user can see their own strike', seen.length === 1, `${seen.length}`);

    const strike2 = await req('POST', `/admin/users/${buyerId}/warnings`, {
      token: admin,
      body: { reason: 'Repeat abusive review.' },
    });
    ok('6d the second strike reaches the configured limit', strike2.warningCount === 2, `${strike2.warningCount}`);
    ok('6e reaching the limit bans the account', strike2.banned === true);

    const banned = await req('GET', `/admin/users?q=${encodeURIComponent(buyerPhone)}`, { token: admin });
    ok('6f the account status is banned', banned[0]?.status === 'banned', `${banned[0]?.status}`);
    ok(
      '6g warning requires a reason',
      (await expectFail('POST', `/admin/users/${buyerId}/warnings`, { token: admin, body: { reason: '' } })) === 400,
    );

    // ── 7. the ban is durable ──────────────────────────────────────
    // Identities are verified, so the row survives and the unique phone is
    // what makes re-registration impossible (§13.2).
    const reRegister = await (async () => {
      const r = await req('POST', '/auth/otp/request', { body: { phone: buyerPhone } });
      return expectFail('POST', '/auth/otp/verify', { body: { phone: buyerPhone, code: r.devCode, accountType: 'customer' } });
    })();
    ok('7a the same verified phone cannot sign in again', reRegister === 401, `status ${reRegister}`);

    const reviewsSurvive = await req('GET', `/users/${agentId}/reviews`);
    ok('7b banning the author does not erase their reviews', reviewsSurvive.count === 2, `${reviewsSurvive.count}`);
  } finally {
    // Restore both settings whatever happened above — a suite that throws must
    // not leave offers switched on or the ban threshold at 2.
    await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: offersWereEnabled } })
      .catch(() => undefined);
    if (warnLimitBefore === null) {
      await req('PUT', '/admin/settings/moderation.warnings_before_ban', { token: admin, body: { value: 3 } })
        .catch(() => undefined);
    } else {
      await req('PUT', '/admin/settings/moderation.warnings_before_ban', { token: admin, body: { value: warnLimitBefore } })
        .catch(() => undefined);
    }
  }

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL REVIEW-MODERATION E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
