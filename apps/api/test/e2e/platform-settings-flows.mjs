/**
 * Self-contained integration test for the platform-settings registry:
 *   1. the catalogue describes every knob the code reads — and no longer
 *      offers the Phase-1 key that was seeded but read by nothing
 *   2. a write is coerced to the declared type, so the string "false" can
 *      never switch a boolean ON
 *   3. anything that cannot be read as the declared type is refused, by name
 *   4. `null` resets a setting to its default rather than storing a copy of it
 *   5. rules that span two settings are enforced against the state a write
 *      would create
 *   6. the values are live: what the catalogue reports is what the public
 *      payload serves
 *   7. reading and writing settings is admin-only
 *
 * Every setting this suite touches is restored to the value it was found at,
 * in a `finally` — `offers.enabled` above all, which ships OFF by decision and
 * must not be left on by a run that died half way through.
 *
 * Run against a live API: `npm run test:e2e:settings`.
 */
const API = process.env.API_BASE ?? 'http://localhost:4000';
const results = [];
let failed = 0;
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // Kept longer than the 200 chars the other suites use: this one asserts on
  // what the refusals actually say, and a truncated message hid the half that
  // names the replacement key.
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return json;
}
/** Returns [status, message] so a refusal can be checked for saying why. */
async function expectFail(method, path, opts = {}) {
  try {
    await req(method, path, opts);
    return [0, ''];
  } catch (e) {
    const status = Number(/-> (\d+):/.exec(e.message)?.[1] ?? -1);
    return [status, e.message];
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

const get = (list, key) => list.find((s) => s.key === key);

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;

  // Captured before anything is touched, and put back in `finally` whatever
  // happens below. `source` matters as much as `value`: a setting found on its
  // default must be left with no row, not with a row that happens to equal it.
  const before = await req('GET', '/admin/settings', { token: admin });
  const TOUCHED = ['offers.enabled', 'assignment.max_agents', 'assignment.min_term_months', 'resale.mode'];
  const original = Object.fromEntries(
    TOUCHED.map((k) => [k, { value: get(before, k)?.value, source: get(before, k)?.source }]),
  );

  try {
    // ── 1. the catalogue ───────────────────────────────────────────
    const declared = before.filter((s) => s.declared);
    ok('1a the catalogue is not empty', declared.length >= 10, `${declared.length} declared`);
    ok(
      '1b every declared setting carries a type, a default and what reads it',
      declared.every((s) => s.type && s.default !== undefined && s.description && s.readBy),
    );

    // The audit that produced this step: seeded in Phase 1, read by nothing,
    // and editable in the console as though it were live.
    ok('1c the retired reviews.* key is gone from the catalogue', get(before, 'reviews.warnings_before_ban') === undefined);
    const warn = get(before, 'moderation.warnings_before_ban');
    ok('1d the key the moderation service actually reads is present', warn !== undefined && warn.declared === true);
    ok('1e ...with the §13.2 default', warn?.default === 3, JSON.stringify(warn?.default));

    // These six were read by code but never seeded, so they did not appear in
    // the console at all — an admin could not see, let alone change, them.
    for (const [i, key] of [
      'offers.enabled',
      'mandate.required_before_publish',
      'moderation.warnings_before_ban',
      'alerts.price_drop_min_pct',
      'referral.credit_expiry_days',
      'referral.featured_days',
    ].entries()) {
      ok(`1f.${i} previously invisible setting ${key} is listed`, get(before, key) !== undefined);
    }

    const resale = get(before, 'resale.mode');
    ok('1g an enum setting carries its options', Array.isArray(resale?.options) && resale.options.includes('owner_direct_allowed'));
    ok(
      '1h ...and says which of them nothing implements yet',
      typeof resale?.seamNote === 'string' && resale.seamNote.includes('owner_direct_allowed'),
      String(resale?.seamNote).slice(0, 60),
    );

    ok(
      '1i no row in the table answers to no declaration',
      before.every((s) => s.declared),
      before.filter((s) => !s.declared).map((s) => s.key).join(', '),
    );

    // ── 2. the string "false" cannot switch a boolean on ───────────
    // The defect this registry exists for: the console posted the raw contents
    // of a text box, so "false" was stored as a string — which is truthy.
    await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: 'false' } });
    const afterFalse = get(await req('GET', '/admin/settings', { token: admin }), 'offers.enabled');
    ok('2a the string "false" is stored as the boolean false', afterFalse.value === false, JSON.stringify(afterFalse.value));
    ok('2b and the public payload agrees', (await req('GET', '/settings/public')).offersEnabled === false);

    await req('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: 'true' } });
    ok('2c the string "true" is stored as the boolean true', (await req('GET', '/settings/public')).offersEnabled === true);

    // ── 3. refusals, each naming the problem ───────────────────────
    const [s3a, m3a] = await expectFail('PUT', '/admin/settings/offers.enabled', { token: admin, body: { value: 'yes' } });
    ok('3a a word that is not true/false is refused', s3a === 400, m3a.slice(-90));
    ok('3b ...and the refusal says what the setting takes', /true\/false/.test(m3a));

    const [s3c] = await expectFail('PUT', '/admin/settings/assignment.max_agents', { token: admin, body: { value: 'three' } });
    ok('3c a word for a number is refused', s3c === 400);

    const [s3d, m3d] = await expectFail('PUT', '/admin/settings/assignment.max_agents', { token: admin, body: { value: 99 } });
    ok('3d a number outside the declared bounds is refused', s3d === 400);
    ok('3e ...naming the bounds', /between 1 and 10/.test(m3d), m3d.slice(-80));

    const [s3f] = await expectFail('PUT', '/admin/settings/assignment.max_agents', { token: admin, body: { value: 2.5 } });
    ok('3f a fraction of an agent is refused', s3f === 400);

    // …while a genuinely fractional setting admits one.
    ok(
      '3g a percentage setting is declared non-integer',
      get(before, 'alerts.price_drop_min_pct').integer === false,
    );

    const [s3h] = await expectFail('PUT', '/admin/settings/resale.mode', { token: admin, body: { value: 'anything_goes' } });
    ok('3h an undeclared enum option is refused', s3h === 400);

    const [s3i, m3i] = await expectFail('PUT', '/admin/settings/some.invented_key', { token: admin, body: { value: 1 } });
    ok('3i an undeclared key is refused rather than becoming a dead row', s3i === 400);
    ok('3j ...and the refusal explains that nothing would read it', /nothing will read it|not a platform setting/.test(m3i));

    const [s3k, m3k] = await expectFail('PUT', '/admin/settings/reviews.warnings_before_ban', { token: admin, body: { value: 3 } });
    ok('3k the retired key is refused by name', s3k === 400);
    ok('3l ...pointing at the key that replaced it', /moderation\.warnings_before_ban/.test(m3k), m3k.slice(-90));

    // ── 4. reset to default ────────────────────────────────────────
    await req('PUT', '/admin/settings/assignment.max_agents', { token: admin, body: { value: 5 } });
    const stored = get(await req('GET', '/admin/settings', { token: admin }), 'assignment.max_agents');
    ok('4a a written value is reported as stored', stored.value === 5 && stored.source === 'stored', `${stored.value}/${stored.source}`);
    ok('4b and is served publicly', (await req('GET', '/settings/public')).maxAgents === 5);

    await req('PUT', '/admin/settings/assignment.max_agents', { token: admin, body: { value: null } });
    const reset = get(await req('GET', '/admin/settings', { token: admin }), 'assignment.max_agents');
    ok('4c null resets to the declared default', reset.value === reset.default, `${reset.value}/${reset.default}`);
    ok('4d ...and the row is gone, so it follows the default from now on', reset.source === 'default', reset.source);

    // ── 5. rules that span two settings ────────────────────────────
    // Each value is legal alone; only the combination is not, so the check has
    // to run against the state the write would create.
    const [s5a, m5a] = await expectFail('PUT', '/admin/settings/assignment.min_term_months', { token: admin, body: { value: 12 } });
    ok('5a a minimum term above the maximum is refused', s5a === 400);
    ok('5b ...naming both settings', /min_term_months/.test(m5a) && /max_term_months/.test(m5a), m5a.slice(-100));
    ok(
      '5c and the value did not land',
      get(await req('GET', '/admin/settings', { token: admin }), 'assignment.min_term_months').value === 1,
    );

    // ── 6. the enum knob is live end to end ────────────────────────
    await req('PUT', '/admin/settings/resale.mode', { token: admin, body: { value: 'owner_direct_allowed' } });
    ok('6a an enum change reaches the public payload', (await req('GET', '/settings/public')).resaleMode === 'owner_direct_allowed');

    // ── 7. admin only ──────────────────────────────────────────────
    const customer = await otp(`+9053${`${Date.now()}`.slice(-7)}1`, 'customer');
    ok('7a reading the settings is admin-only', (await expectFail('GET', '/admin/settings', { token: customer }))[0] === 403);
    ok('7b and not public', (await expectFail('GET', '/admin/settings'))[0] === 401);
    ok(
      '7c writing is admin-only',
      (await expectFail('PUT', '/admin/settings/offers.enabled', { token: customer, body: { value: true } }))[0] === 403,
    );
  } finally {
    // Restore exactly as found: a setting that was on its default is reset with
    // `null` rather than written back, or this suite would leave rows behind
    // that pin values which were only ever defaults.
    for (const key of TOUCHED) {
      const o = original[key];
      const value = o && o.source === 'stored' ? o.value : null;
      await req('PUT', `/admin/settings/${key}`, { token: admin, body: { value } }).catch(() => undefined);
    }
  }

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL PLATFORM-SETTINGS E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
