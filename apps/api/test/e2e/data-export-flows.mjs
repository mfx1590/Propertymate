/**
 * Self-contained integration test for the admin audit-log browser and CSV
 * exports (Plan §6.7 "audit log browser", §10.2 Phase 3 "data export /
 * reporting", step 27).
 *
 * Three things are on trial:
 *
 *   1. `audit.view` finally gates something. The audit table has been written
 *      by every action since step 1 and read by nothing; the browser filters
 *      it by actor, action, entity and time window, and pages by cursor.
 *   2. exports are safe to open. A listing title of `=1+1, "quoted"` + a line
 *      break is the whole CSV threat model in one string: formula injection,
 *      delimiter, quote and newline. The file must round-trip it through a
 *      real RFC 4180 parse with the formula neutralised — and carry the UTF-8
 *      BOM, without which Excel mangles every Turkish and Cyrillic character.
 *   3. an export is itself audited, with the true row count — the one line in
 *      this log an auditor will actually look for.
 *
 * Counts are compared against the datasets endpoint captured immediately
 * before each export, so the suite is indifferent to whatever else the
 * database holds. Nothing global is touched.
 *
 * Run against a live API: `npm run test:e2e:exports`.
 */
const API = process.env.API_BASE ?? 'http://localhost:4000';
const results = [];
let failed = 0;
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function raw(method, path, { token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API}${path}`, { method, headers });
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
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

/**
 * A real RFC 4180 parse — quoted fields, doubled quotes, line breaks inside
 * quotes, CRLF rows — because a regex split would pass a broken file.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r') { /* CRLF: consumed by the \n */ }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const BOM = '﻿';

/**
 * `Response.text()` silently strips a leading BOM (WHATWG decoding), which
 * would make the one assertion about it impossible. Decode the bytes with the
 * BOM preserved so the file is judged as Excel will actually receive it.
 */
const csvText = async (res) =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const adminId = (await req('GET', '/users/me', { token: admin })).id;
  const u = `${Date.now()}`.slice(-7);
  const TAG = `zqxexport${u}`;
  const ownerPhone = `+9053${u}7`;
  const owner = await otp(ownerPhone, 'owner');
  const ownerId = (await req('GET', '/users/me', { token: owner })).id;
  await req('POST', '/admin/subscriptions/grant', { token: admin, body: { identifier: ownerPhone, planKey: 'owner_basic' } });

  // The whole CSV threat model in one title: formula, delimiter, quote, newline.
  const HOSTILE = `=1+1, "${TAG}"\nsecond line`;
  const listing = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
  await req('PUT', `/properties/${listing.id}`, { token: owner, body: { title: HOSTILE, regionSlug: 'lefke' } });

  // ── 1. the audit-log browser ─────────────────────────────────────
  const page = await req('GET', '/admin/audit?limit=5', { token: admin });
  ok('1a the browser returns rows and a cursor', Array.isArray(page.rows) && page.rows.length === 5 && typeof page.nextCursor === 'string', `${page.rows.length}`);
  ok('1b rows carry the actor’s identity, not a bare id', page.rows.some((r) => r.actor && (r.actor.phone || r.actor.email)), JSON.stringify(page.rows[0]?.actor ?? null));

  const byActor = await req('GET', `/admin/audit?actorId=${ownerId}`, { token: admin });
  ok('1c filtering by actor returns only that actor’s rows', byActor.rows.length > 0 && byActor.rows.every((r) => r.actorId === ownerId), `${byActor.rows.length}`);
  ok('1d and the signup that created them is there', byActor.rows.some((r) => r.action === 'user.register.otp'), byActor.rows.map((r) => r.action).join(','));

  const byEntity = await req('GET', `/admin/audit?entityType=user&entityId=${ownerId}`, { token: admin });
  ok('1e filtering by entity finds the rows about that entity', byEntity.rows.length > 0 && byEntity.rows.every((r) => r.entityType === 'user' && r.entityId === ownerId), `${byEntity.rows.length}`);

  const byAction = await req('GET', `/admin/audit?action=user.register.otp&actorId=${ownerId}`, { token: admin });
  ok('1f filtering by action narrows to exactly that action', byAction.rows.length === 1 && byAction.rows[0].action === 'user.register.otp', `${byAction.rows.length}`);

  const future = new Date(Date.now() + 3_600_000).toISOString();
  const nothingYet = await req('GET', `/admin/audit?from=${encodeURIComponent(future)}`, { token: admin });
  ok('1g a window in the future is empty', nothingYet.rows.length === 0 && nothingYet.nextCursor === null, `${nothingYet.rows.length}`);
  ok('1h a window that ends before it starts is refused', (await expectFail('GET', `/admin/audit?from=${encodeURIComponent(future)}&to=2020-01-01T00:00:00Z`, { token: admin })) === 400);

  const p1 = await req('GET', '/admin/audit?limit=2', { token: admin });
  const p2 = await req('GET', `/admin/audit?limit=2&cursor=${p1.nextCursor}`, { token: admin });
  ok('1i the cursor pages forward without overlap', p2.rows.length === 2 && !p2.rows.some((r) => p1.rows.some((x) => x.id === r.id)));

  const actions = await req('GET', '/admin/audit/actions', { token: admin });
  ok('1j the action list is real and sorted', Array.isArray(actions) && actions.includes('user.register.otp') && [...actions].sort().join() === actions.join(), `${actions.length} actions`);

  ok('1k the browser needs audit.view — an owner is refused', (await expectFail('GET', '/admin/audit', { token: owner })) === 403);
  ok('1l and it is not public', (await expectFail('GET', '/admin/audit')) === 401);

  // ── 2. exports ───────────────────────────────────────────────────
  const datasets = await req('GET', '/admin/exports', { token: admin });
  ok('2a every dataset reports a live count', ['users', 'listings', 'deals', 'subscriptions', 'payments', 'disputes', 'audit'].every((k) => Number.isInteger(datasets[k])), JSON.stringify(datasets));

  const usersRes = await raw('GET', '/admin/exports/users', { token: admin });
  const usersText = await csvText(usersRes);
  ok('2b the file is served as CSV for download', usersRes.status === 200 && /text\/csv/.test(usersRes.headers.get('content-type') ?? '') && /attachment; filename="propverify-users-\d{4}-\d{2}-\d{2}\.csv"/.test(usersRes.headers.get('content-disposition') ?? ''), usersRes.headers.get('content-disposition') ?? '');
  ok('2c it opens with the UTF-8 BOM Excel needs for Turkish and Cyrillic', usersText.startsWith(BOM));

  const users = parseCsv(usersText.slice(BOM.length));
  ok('2d the header row is exactly the documented columns', users[0].join(',') === 'id,phone,email,locale,status,roles,created_at', users[0].join(','));
  const ownerRow = users.find((r) => r[0] === ownerId);
  ok('2e the account created by this suite is in the file, with its roles', !!ownerRow && ownerRow[1] === ownerPhone && ownerRow[5].split('|').includes('owner'), JSON.stringify(ownerRow ?? null));
  ok('2f the data-row count matches the dataset count', users.length - 1 === datasets.users, `${users.length - 1} vs ${datasets.users}`);
  ok('2g no password hash leaves in the file', !usersText.includes('$2a$') && !usersText.includes('$2b$') && !users[0].some((h) => /password|hash|token/i.test(h)));

  const listingsText = (await csvText(await raw('GET', '/admin/exports/listings', { token: admin }))).slice(BOM.length);
  const listings = parseCsv(listingsText);
  const titleIdx = listings[0].indexOf('title_en');
  const mine = listings.find((r) => r[0] === listing.id);
  ok('2h the hostile title round-trips through a real CSV parse', !!mine && mine[titleIdx] === `'${HOSTILE}`, JSON.stringify(mine?.[titleIdx] ?? null));
  ok('2i the formula is neutralised with a leading apostrophe', !!mine && mine[titleIdx].startsWith(`'=`));
  ok('2j the raw file quoted it — the line break is inside quotes, not a new row', listingsText.includes(`"'=1+1, ""${TAG}""\nsecond line"`));

  // The guard must not touch what cannot be a formula: a reversal in the
  // ledger is a negative number, and an apostrophe in front of it would break
  // every sum an admin runs on the column. The payment suite leaves one behind.
  const payments = parseCsv((await csvText(await raw('GET', '/admin/exports/payments', { token: admin }))).slice(BOM.length));
  const amountIdx = payments[0].indexOf('amount');
  const negatives = payments.slice(1).map((r) => r[amountIdx]).filter((c) => /^'?-/.test(c));
  ok('2l a negative ledger amount exports as a bare number, not a quoted formula', negatives.length > 0 && negatives.every((c) => /^-\d/.test(c)), negatives.slice(0, 3).join(','));

  const auditCsv = parseCsv((await csvText(await raw('GET', `/admin/exports/audit?actorId=${ownerId}`, { token: admin }))).slice(BOM.length));
  const actorCol = auditCsv[0].indexOf('actor_id');
  ok('2k the audit export honours the browser’s filters', auditCsv.length > 1 && auditCsv.slice(1).every((r) => r[actorCol] === ownerId), `${auditCsv.length - 1} rows`);

  // ── 3. an export is itself audited ───────────────────────────────
  const trail = await req('GET', `/admin/audit?action=data.export&actorId=${adminId}&limit=5`, { token: admin });
  const usersExport = trail.rows.find((r) => r.entityId === 'users');
  ok('3a the users export was logged against the admin who pulled it', !!usersExport, trail.rows.map((r) => r.entityId).join(','));
  ok('3b with the true number of rows that left', usersExport?.after?.rowCount === users.length - 1, JSON.stringify(usersExport?.after ?? null));
  const auditExport = trail.rows.find((r) => r.entityId === 'audit');
  ok('3c and the filters an export was pulled with', auditExport?.after?.filter?.actorId === ownerId, JSON.stringify(auditExport?.after?.filter ?? null));

  // ── 4. edges and gates ───────────────────────────────────────────
  const unknown = await raw('GET', '/admin/exports/passwords', { token: admin });
  ok('4a an unknown dataset is a 404, not an empty file', unknown.status === 404 && !/text\/csv/.test(unknown.headers.get('content-type') ?? ''), `${unknown.status}`);
  ok('4b exports need user.manage — an owner is refused', (await raw('GET', '/admin/exports/users', { token: owner })).status === 403);
  ok('4c and they are not public', (await raw('GET', '/admin/exports/users')).status === 401);
  ok('4d the dataset list is gated the same way', (await expectFail('GET', '/admin/exports', { token: owner })) === 403);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL DATA-EXPORT E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
