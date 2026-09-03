/**
 * Self-contained integration test for plan pricing + the payment ledger
 * (Plan §9, §13.3 — Phase 3 payments, the subscription half).
 *
 * Three disciplines are being pinned, because each is the kind that silently
 * erodes:
 *
 * **Prices are chosen, never invented.** A plan seeds unpriced and says so
 * (`priced: false`) rather than implying "free" with a missing number; pricing
 * one is an explicit admin act that can also be explicitly undone.
 *
 * **The ledger is append-only.** A wrong entry is corrected by a reversal row
 * pointing at it — the original is never touched, a reversal cannot be
 * reversed, and one entry cannot be reversed twice. Both money columns negate
 * on reversal so the totals stay honest by plain summation.
 *
 * **`listAmount` is frozen at grant time.** Repricing a plan must not rewrite
 * what an already-granted period was worth — the same snapshot principle the
 * deal room froze prices with in Phase 1.
 *
 * And one regression check that matters more than all of it: **nothing here
 * gates access.** A waived (unpaid) subscription still lets an owner create a
 * listing, exactly as every subscription has since the 2026-07-12 manual-grant
 * decision. Payment becoming a condition of listing is a business decision,
 * not a side effect of this table existing.
 *
 * Totals are asserted as DELTAS against whatever the database already holds,
 * and the suite prices its plan in EUR to keep out of the demo data's GBP
 * lane. The plan it prices is restored to exactly what it found in `finally`,
 * failure paths included — a leftover price would misprice every later grant
 * of that plan in this database.
 *
 * Run against a live API: `npm run test:e2e:payments`.
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

/** The EUR row of the admin totals, or zeros when the bucket does not exist. */
async function eurTotals(admin) {
  const ledger = await req('GET', '/admin/payments', { token: admin });
  return (
    ledger.totals.find((t) => t.currency === 'EUR') ?? { currency: 'EUR', collected: 0, listed: 0, foregone: 0 }
  );
}

const PLAN = 'owner_basic';
const PRICE = 120;

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const ownerPhone = `+9053${u}1`;
  const bystanderPhone = `+9053${u}2`;

  // Captured before anything is touched, restored in `finally` no matter what.
  const planBefore = (await req('GET', '/plans')).find((p) => p.key === PLAN);
  if (!planBefore) throw new Error(`${PLAN} not seeded`);

  const owner = await otp(ownerPhone, 'owner');
  const bystander = await otp(bystanderPhone, 'customer');

  try {
    // ── 1. a price is chosen, shown, and revocable ───────────────────
    ok(
      '1a the plan list is public and explicit about pricing',
      typeof planBefore.priced === 'boolean' && 'priceAmount' in planBefore,
      JSON.stringify(planBefore),
    );

    const priced = await req('PUT', `/admin/plans/${PLAN}/price`, {
      token: admin,
      body: { priceAmount: PRICE, currency: 'EUR', interval: 'month' },
    });
    ok('1b an admin can price a plan', priced.priceAmount === PRICE && priced.currency === 'EUR' && priced.priced === true, JSON.stringify(priced));

    const publicNow = (await req('GET', '/plans')).find((p) => p.key === PLAN);
    ok('1c the public list reflects it immediately', publicNow.priceAmount === PRICE && publicNow.priced === true, JSON.stringify(publicNow));

    const cleared = await req('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: null } });
    ok('1d clearing a price is a real operation, not an error', cleared.priced === false && cleared.priceAmount === null && cleared.currency === null, JSON.stringify(cleared));

    // Back to priced for the grant tests below.
    await req('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: PRICE, currency: 'EUR', interval: 'month' } });

    ok('1e a price without a currency is refused', (await expectFail('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: 10 } })) === 400);
    ok('1f a price without an interval is refused', (await expectFail('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: 10, currency: 'EUR' } })) === 400);
    ok('1g a negative price is refused', (await expectFail('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: -5, currency: 'EUR', interval: 'month' } })) === 400);
    ok('1h an unknown currency is refused', (await expectFail('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: 10, currency: 'BTC', interval: 'month' } })) === 400);
    ok('1i an unknown plan is refused', (await expectFail('PUT', '/admin/plans/no_such_plan/price', { token: admin, body: { priceAmount: 10, currency: 'EUR', interval: 'month' } })) === 404);
    ok('1j pricing is admin-only', (await expectFail('PUT', `/admin/plans/${PLAN}/price`, { token: owner, body: { priceAmount: 1, currency: 'EUR', interval: 'month' } })) === 403);

    // ── 2. every grant writes the money down ─────────────────────────
    const base = await eurTotals(admin);

    const paid = await req('POST', '/admin/subscriptions/grant', {
      token: admin,
      body: {
        identifier: ownerPhone,
        planKey: PLAN,
        months: 12,
        payment: { amount: PRICE, reference: `BANK-${u}`, note: 'paid by transfer' },
      },
    });
    ok('2a a paid grant records the payment', paid.payment?.status === 'recorded' && paid.payment.amount === PRICE, JSON.stringify(paid.payment ?? null));
    ok('2b with the plan price frozen into the row', paid.payment.listAmount === PRICE && paid.payment.currency === 'EUR');
    ok('2c and the offline reference kept', paid.payment.providerRef === `BANK-${u}`, paid.payment.providerRef);
    ok('2d through the only provider there is', paid.payment.provider === 'manual', paid.payment.provider);

    const waived = await req('POST', '/admin/subscriptions/grant', {
      token: admin,
      body: { identifier: ownerPhone, planKey: PLAN, months: 1 },
    });
    ok('2e a grant with no payment is a waived row, not silence', waived.payment?.status === 'waived' && waived.payment.amount === 0, JSON.stringify(waived.payment ?? null));
    ok('2f a waived row still remembers what it was worth', waived.payment.listAmount === PRICE, `${waived.payment.listAmount}`);

    const afterGrants = await eurTotals(admin);
    ok('2g collected moved by exactly the money taken', afterGrants.collected - base.collected === PRICE, `${afterGrants.collected - base.collected}`);
    ok('2h listed moved by both periods', afterGrants.listed - base.listed === PRICE * 2, `${afterGrants.listed - base.listed}`);
    ok('2i foregone is the comped period', afterGrants.foregone - base.foregone === PRICE, `${afterGrants.foregone - base.foregone}`);

    // The freeze, tested the only way that means anything: change the price
    // and check history did not move.
    await req('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: PRICE * 3, currency: 'EUR', interval: 'month' } });
    let mine = await req('GET', '/users/me/payments', { token: owner });
    const frozen = mine.filter((e) => e.listAmount === PRICE).length;
    ok('2j repricing the plan does not rewrite recorded history', frozen >= 2 && mine.every((e) => e.listAmount !== PRICE * 3), JSON.stringify(mine.map((e) => e.listAmount)));
    await req('PUT', `/admin/plans/${PLAN}/price`, { token: admin, body: { priceAmount: PRICE, currency: 'EUR', interval: 'month' } });

    ok('2k the user sees their own money history', mine.length >= 2 && mine.some((e) => e.status === 'recorded') && mine.some((e) => e.status === 'waived'), `${mine.length} rows`);
    const other = await req('GET', '/users/me/payments', { token: bystander });
    ok('2l and nobody else’s', other.length === 0, `${other.length}`);

    // ── 3. append-only: corrections are rows, not edits ──────────────
    const reversal = await req('POST', `/admin/payments/${paid.payment.id}/reverse`, {
      token: admin,
      body: { note: 'recorded against the wrong account' },
    });
    ok('3a a reversal is its own negative row', reversal.status === 'reversal' && reversal.amount === -PRICE, JSON.stringify({ s: reversal.status, a: reversal.amount }));
    ok('3b pointing at what it cancels', reversal.reversesEntryId === paid.payment.id);

    mine = await req('GET', '/users/me/payments', { token: owner });
    const original = mine.find((e) => e.id === paid.payment.id);
    ok('3c the original row is untouched — still there, still `recorded`', original?.status === 'recorded' && original.amount === PRICE, JSON.stringify(original ?? null));

    ok('3d an entry cannot be reversed twice', (await expectFail('POST', `/admin/payments/${paid.payment.id}/reverse`, { token: admin, body: {} })) === 400);
    ok('3e a reversal cannot itself be reversed', (await expectFail('POST', `/admin/payments/${reversal.id}/reverse`, { token: admin, body: {} })) === 400);

    const afterReversal = await eurTotals(admin);
    ok('3f the totals read true after the correction', afterReversal.collected - base.collected === 0, `${afterReversal.collected - base.collected}`);

    // ── 4. who can see and touch money ───────────────────────────────
    ok('4a the ledger is admin-only', (await expectFail('GET', '/admin/payments', { token: owner })) === 403);
    ok('4b and not public', (await expectFail('GET', '/admin/payments')) === 401);
    ok('4c reversing is admin-only', (await expectFail('POST', `/admin/payments/${paid.payment.id}/reverse`, { token: owner, body: {} })) === 403);
    ok('4d a payment history needs a signed-in account', (await expectFail('GET', '/users/me/payments')) === 401);

    const ledger = await req('GET', '/admin/payments', { token: admin });
    const row = ledger.entries.find((e) => e.id === paid.payment.id);
    ok('4e the admin ledger names who the money came from', !!row?.user && (row.user.phone === ownerPhone || !!row.user.email), JSON.stringify(row?.user ?? null));

    // ── 5. nothing here gates access ─────────────────────────────────
    // The owner's live subscription is the WAIVED one plus a reversed payment —
    // between them, not a cent stands collected. Listing creation must not care.
    const listing = await req('POST', '/properties', { token: owner, body: { kind: 'rental' } });
    ok('5a an unpaid subscription still opens the platform (§13.3 unchanged)', !!listing.id, listing.id);
  } finally {
    // Exactly what was found, priced or not — a suite must not leave a plan
    // costing something it did not cost before the run.
    await req('PUT', `/admin/plans/${PLAN}/price`, {
      token: admin,
      body: planBefore.priced
        ? { priceAmount: planBefore.priceAmount, currency: planBefore.currency, interval: planBefore.interval }
        : { priceAmount: null },
    }).catch(() => undefined);
  }

  const restored = (await req('GET', '/plans')).find((p) => p.key === PLAN);
  ok(
    '6a the plan left the suite exactly as it entered',
    restored.priced === planBefore.priced && restored.priceAmount === planBefore.priceAmount,
    JSON.stringify({ before: planBefore.priceAmount, after: restored.priceAmount }),
  );

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL PAYMENT-LEDGER E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
