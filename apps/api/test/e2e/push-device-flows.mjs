/**
 * Self-contained integration test for the push-device lifecycle (Plan §6.6),
 * i.e. the API contract the Expo app in `apps/mobile` depends on:
 *   1. a device registers, and registering the same token twice is idempotent
 *      rather than piling up duplicate rows (the app re-registers on every
 *      sign-in, so this happens constantly)
 *   2. a phone that changes hands follows the device: the token moves to the
 *      new account instead of leaving the previous owner's notifications
 *      going to someone else's handset
 *   3. sign-out unregisters, and one account cannot unregister another's token
 *   4. push is selectable per notification category, which is what the app's
 *      alerts screen offers (the "no registered device" delivery outcome is
 *      already covered by notification-channel-flows check 4d)
 *   5. registration is authenticated and input-validated
 *
 * Every account and token here is created by the suite. Run against a live
 * API: `npm run test:e2e:push`.
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

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const u = `${Date.now()}`.slice(-7);
  // 53x is a real Turkish mobile range — IsPhoneNumber checks operator
  // prefixes, not just the shape.
  const alicePhone = `+9053${u}5`;
  const bobPhone = `+9053${u}6`;

  const alice = await otp(alicePhone, 'customer');
  const bob = await otp(bobPhone, 'customer');

  // A realistic Expo token — the API stores it opaquely, but using the real
  // shape keeps the fixture honest about what the app actually sends.
  const DEVICE = `ExponentPushToken[e2e-${u}-handset]`;
  const SECOND = `ExponentPushToken[e2e-${u}-tablet]`;

  // ── 1. register + idempotency ────────────────────────────────────
  const first = await req('POST', '/users/me/push-tokens', {
    token: alice,
    body: { token: DEVICE, platform: 'android' },
  });
  ok('1a a device registers', first.token === DEVICE, JSON.stringify(first));
  ok('1b the platform is recorded', first.platform === 'android', first.platform);

  const again = await req('POST', '/users/me/push-tokens', {
    token: alice,
    body: { token: DEVICE, platform: 'android' },
  });
  ok('1c re-registering the same device is idempotent', again.id === first.id, `${first.id} vs ${again.id}`);

  const second = await req('POST', '/users/me/push-tokens', {
    token: alice,
    body: { token: SECOND, platform: 'ios' },
  });
  ok('1d a second device is a separate registration', second.id !== first.id);
  ok('1e platform is per device', second.platform === 'ios', second.platform);

  // ── 2. the token follows the device, not the account ─────────────
  const moved = await req('POST', '/users/me/push-tokens', {
    token: bob,
    body: { token: DEVICE, platform: 'android' },
  });
  ok('2a the same handset re-registers under the new account', moved.token === DEVICE);
  ok('2b it is the same row, moved rather than duplicated', moved.id === first.id, `${first.id} vs ${moved.id}`);

  // The previous owner must no longer be able to reach that handset — proven
  // by their delete finding nothing, since the row now belongs to Bob.
  const staleRemove = await req('DELETE', `/users/me/push-tokens/${encodeURIComponent(DEVICE)}`, { token: alice });
  ok('2c the previous owner can no longer unregister it', staleRemove.removed === 0, `${staleRemove.removed}`);

  // ── 3. unregister on sign-out ────────────────────────────────────
  const removed = await req('DELETE', `/users/me/push-tokens/${encodeURIComponent(DEVICE)}`, { token: bob });
  ok('3a the current owner unregisters their device', removed.removed === 1, `${removed.removed}`);
  const twice = await req('DELETE', `/users/me/push-tokens/${encodeURIComponent(DEVICE)}`, { token: bob });
  ok('3b unregistering twice is harmless', twice.removed === 0, `${twice.removed}`);

  const otherPersons = await req('DELETE', `/users/me/push-tokens/${encodeURIComponent(SECOND)}`, { token: bob });
  ok("3c one account cannot unregister another's device", otherPersons.removed === 0, `${otherPersons.removed}`);
  const own = await req('DELETE', `/users/me/push-tokens/${encodeURIComponent(SECOND)}`, { token: alice });
  ok('3d the owner still can', own.removed === 1, `${own.removed}`);

  // ── 4. push is a selectable channel ──────────────────────────────
  // Registering a device is only half the contract: the category has to be
  // willing to use the push channel, which is what the app's alerts screen
  // is really turning on.
  await req('PUT', '/users/me/notification-preferences/viewing', {
    token: alice,
    body: { channels: ['in_app', 'push'] },
  });
  const prefs = await req('GET', '/users/me/notification-preferences', { token: alice });
  const viewingPref = Array.isArray(prefs)
    ? prefs.find((p) => p.category === 'viewing')
    : prefs.viewing;
  ok(
    '4a push can be switched on per category',
    JSON.stringify(viewingPref ?? prefs).includes('push'),
    JSON.stringify(viewingPref ?? prefs).slice(0, 160),
  );

  // ── 5. access control + validation ───────────────────────────────
  ok('5a registration requires an account', (await expectFail('POST', '/users/me/push-tokens', { body: { token: 'x' } })) === 401);
  ok('5b unregistering requires an account', (await expectFail('DELETE', '/users/me/push-tokens/x')) === 401);
  ok(
    '5c an empty token is rejected',
    (await expectFail('POST', '/users/me/push-tokens', { token: alice, body: { token: '   ' } })) === 400,
  );
  ok(
    '5d a missing token is rejected',
    (await expectFail('POST', '/users/me/push-tokens', { token: alice, body: {} })) === 400,
  );

  // Platform is optional — the app omits it on platforms it cannot name.
  const noPlatform = await req('POST', '/users/me/push-tokens', {
    token: alice,
    body: { token: `${DEVICE}-noplatform` },
  });
  ok('5e platform is optional', noPlatform.platform === 'unknown', noPlatform.platform);
  await req('DELETE', `/users/me/push-tokens/${encodeURIComponent(`${DEVICE}-noplatform`)}`, { token: alice });

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL PUSH-DEVICE E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
