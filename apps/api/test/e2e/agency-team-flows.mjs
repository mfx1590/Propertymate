/**
 * Self-contained integration test for agency team management (Plan §13.1–13.2):
 *   1. verify an agency profile through the existing verification engine
 *   2. org admin adds members by phone — new accounts and existing users
 *   3. members inherit the agency's verification and can work listings
 *   4. one-agency-per-user is enforced; the agency account can't add itself
 *   5. a member promoted to org_admin can manage the team; a plain member cannot
 *   6. deactivation actually revokes the member's permissions
 *   7. public agency page shows the verified tick, per-member stats and totals,
 *      and never leaks member contact details
 *
 * Creates every actor itself; needs only the base seed. Run against a live API:
 * `npm run test:e2e:team`.
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
  const r = await req('POST', '/auth/otp/request', { body: { phone } });
  const v = await req('POST', '/auth/otp/verify', { body: { phone, code: r.devCode, accountType } });
  return v.accessToken;
}
function pdf(documentType) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 e2e-team')], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  const agencyPhone = `+9053${u}1`;
  const memberPhone = `+9053${u}2`;
  const adminMemberPhone = `+9053${u}3`;
  const outsiderPhone = `+9053${u}4`;

  // ── 1. agency registers and gets verified ────────────────────────
  const agency = await otp(agencyPhone, 'agency');
  await req('PUT', '/users/me/profile/agency', {
    token: agency,
    body: { companyName: `E2E Realty ${u}`, regNo: `REG-${u}`, taxNo: `TAX-${u}`, about: 'Team test agency' },
  });
  const agencyId = (await req('GET', '/users/me', { token: agency })).id;

  for (const dt of ['company_registration', 'tax_number']) {
    await req('POST', '/users/me/profile/agency/documents', { token: agency, form: pdf(dt) });
  }

  let queue = await req('GET', '/admin/verification/queue?entityType=profile', { token: admin });
  const profItem = queue.find((q) => q.summary?.lister === agencyPhone);
  ok('1b agency profile entered the verification queue', !!profItem);
  const profDetail = await req('GET', `/admin/verification/${profItem.id}`, { token: admin });
  await req('POST', `/admin/verification/${profItem.id}/decision`, {
    token: admin,
    body: { documentDecisions: profDetail.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
  });
  const agencyRoles = await req('GET', '/users/me/roles', { token: agency });
  ok('1c agency verified after approval', agencyRoles.find((r) => r.role.key === 'agency')?.verificationStatus === 'verified');

  // the agency is the paying entity; members list under its subscription (§13.3)
  await req('POST', '/admin/subscriptions/grant', {
    token: admin,
    body: { identifier: agencyPhone, planKey: 'agency_basic', months: 12 },
  });

  // ── 2. adding members ────────────────────────────────────────────
  const empty = await req('GET', '/agency/members', { token: agency });
  ok('2a new agency has no members', empty.length === 0, `got ${empty.length}`);

  const member = await req('POST', '/agency/members', {
    token: agency,
    body: { phone: memberPhone, bio: 'Handles Kyrenia rentals', regions: ['kyrenia'] },
  });
  ok('2b member created from an unknown phone', !!member.userId && member.orgRole === 'member');

  const selfAdd = await expectFail('POST', '/agency/members', { token: agency, body: { phone: agencyPhone } });
  ok('2c agency cannot add its own account', selfAdd === 400, `status ${selfAdd}`);

  const dupe = await expectFail('POST', '/agency/members', { token: agency, body: { phone: memberPhone } });
  ok('2d the same person cannot be added twice', dupe === 400, `status ${dupe}`);

  // an existing user (registered independently) can be linked. Their token is
  // kept rather than re-authenticating later: /auth/otp/request allows only
  // 5 per minute per IP (§2.4) and this suite has to stay under that.
  const orgAdminToken = await otp(adminMemberPhone, 'customer');
  const promoted = await req('POST', '/agency/members', {
    token: agency,
    body: { phone: adminMemberPhone, orgRole: 'org_admin' },
  });
  ok('2e existing user linked as a member', promoted.orgRole === 'org_admin');

  const members = await req('GET', '/agency/members', { token: agency });
  ok('2f both members listed', members.length === 2, `got ${members.length}`);
  ok('2g member stats start at zero', members.every((m) => m.salesClosed === 0 && m.rentalsClosed === 0));

  // ── 3. the member inherits verification and can work listings ────
  const memberToken = await otp(memberPhone);
  const memberRoles = await req('GET', '/users/me/roles', { token: memberToken });
  const memberRole = memberRoles.find((r) => r.role.key === 'agency_member');
  ok('3a member holds the agency_member role', !!memberRole);
  ok('3b member inherited the agency verification', memberRole?.verificationStatus === 'verified');

  // the member has no subscription of their own — this passes only because the
  // agency's subscription covers its staff (§13.3)
  const ownSubs = await req('GET', '/users/me/subscriptions', { token: memberToken }).catch(() => []);
  ok('3c member holds no subscription of their own', ownSubs.length === 0, `got ${ownSubs.length}`);
  const listing = await req('POST', '/properties', { token: memberToken, body: { kind: 'rental' } });
  ok('3d member lists under the agency subscription', !!listing.id);

  // ── 4. org-role enforcement ──────────────────────────────────────
  const plainMemberAdds = await expectFail('POST', '/agency/members', {
    token: memberToken,
    body: { phone: outsiderPhone },
  });
  ok('4a a plain member cannot manage the team', plainMemberAdds === 403, `status ${plainMemberAdds}`);

  const viaOrgAdmin = await req('GET', '/agency/members', { token: orgAdminToken });
  ok('4b a promoted org_admin can manage the team', viaOrgAdmin.length === 2, `got ${viaOrgAdmin.length}`);

  // a second agency cannot poach a member who already belongs to one
  const rivalPhone = `+9053${u}5`;
  const rival = await otp(rivalPhone, 'agency');
  await req('PUT', '/users/me/profile/agency', {
    token: rival,
    body: { companyName: `Rival Realty ${u}`, regNo: `R-${u}`, taxNo: `RT-${u}` },
  });
  const poach = await expectFail('POST', '/agency/members', { token: rival, body: { phone: memberPhone } });
  ok('4c a member cannot belong to two agencies', poach === 400, `status ${poach}`);

  // ── 5. public agency page ────────────────────────────────────────
  const pub = await req('GET', `/agencies/${agencyId}`);
  ok('5a public agency page is reachable', pub.userId === agencyId);
  ok('5b verified tick is published', pub.verified === true);
  ok('5c both members are listed publicly', pub.members.length === 2, `got ${pub.members.length}`);
  ok('5d org totals are present', pub.totals.members === 2 && pub.totals.salesClosed === 0);
  ok('5e public payload never exposes member phones', !JSON.stringify(pub).includes(memberPhone));
  ok('5f public payload never exposes org roles', !JSON.stringify(pub.members).includes('org_admin'));

  const rivalId = (await req('GET', '/users/me', { token: rival })).id;
  ok('5g an unverified agency has no public page', (await expectFail('GET', `/agencies/${rivalId}`)) === 404);

  // ── 6. deactivation revokes access ───────────────────────────────
  await req('DELETE', `/agency/members/${member.userId}`, { token: agency });
  const afterRemoval = await req('GET', '/agency/members', { token: agency });
  ok('6a member shows as deactivated', afterRemoval.find((m) => m.userId === member.userId)?.status === 'deactivated');

  const pubAfter = await req('GET', `/agencies/${agencyId}`);
  ok('6b deactivated member drops off the public page', pubAfter.members.length === 1, `got ${pubAfter.members.length}`);

  const revoked = await expectFail('POST', '/properties', { token: memberToken, body: { kind: 'rental' } });
  ok('6c deactivated member loses listing permissions', revoked === 403, `status ${revoked}`);

  // ── 7. re-adding restores the member ─────────────────────────────
  const readded = await req('POST', '/agency/members', { token: agency, body: { phone: memberPhone } });
  ok('7a a removed member can be re-added', readded.status === 'active');
  const restored = await req('POST', '/properties', { token: memberToken, body: { kind: 'rental' } });
  ok("7b re-added member regains listing permissions", !!restored.id);

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL AGENCY-TEAM E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
