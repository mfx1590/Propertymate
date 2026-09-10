/**
 * Self-contained integration test for document-number OCR on identity papers
 * (Plan §13.2 durable bans; step 28 — the half step 21 said a hash could not do).
 *
 * Step 21 recorded a banned account's identity documents by file hash and said
 * plainly what that proves: the same FILE re-uploaded, not the same PERSON. A
 * passport photographed again hashes differently every time. This suite pins
 * the other key:
 *
 *   1. an uploaded identity document gets its number read (from the MRZ, the
 *      machine-readable zone every passport carries), in the background
 *   2. banning the account records that number's hash beside the file hash
 *   3. a DIFFERENT image of the SAME document — different pixels, different
 *      sha256, same number — is flagged as the banned identity, with a signal
 *      that says so, and approval is refused
 *   4. a different number is not flagged and approves normally; a document
 *      with nothing legible records nothing rather than a guess
 *   5. reinstating the banned account clears both keys
 *
 * The images are generated here with sharp (already a dependency for the
 * media pipeline): white cards with a printed number and an MRZ block, at two
 * different sizes so the bytes differ. Real photos read worse than this; the
 * suite tests the pipeline, and the code around it is written for the case
 * where nothing legible comes back.
 *
 * The banned account is reinstated in `finally` — a leftover ban would flag
 * every later suite that reuses these numbers.
 *
 * Run against a live API: `npm run test:e2e:ocr`.
 */
import sharp from 'sharp';

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

/** Poll until the predicate holds, or give up. */
async function retry(fn, predicate, tries = 40, gap = 500) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (predicate(last)) return last;
    await sleep(gap);
  }
  return last;
}

/**
 * A synthetic passport data page: a printed number and a TD3 machine-readable
 * zone whose second line begins with the document number. `scale` changes
 * the rendered size so two cards with the same number have different bytes.
 */
/** ICAO 9303 check digit (7-3-1 weights, A=10…Z=35, `<`=0, mod 10). */
function mrzCheckDigit(field) {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const ch = field[i];
    const v = ch === '<' ? 0 : /[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55;
    sum += v * w[i % 3];
  }
  return sum % 10;
}

async function passportPng(number, scale) {
  const w = Math.round(1000 * scale);
  const h = Math.round(640 * scale);
  const fs = Math.round(38 * scale);
  const mrz1 = 'P<GBRDOE<<JOHN<ANDREW<<<<<<<<<<<<<<<<<<<<<<<<'.padEnd(44, '<');
  // A real check digit after the number: the API verifies reads against it
  // and repairs single confused glyphs, so the card must carry a true one.
  const field = number.padEnd(9, '<');
  const mrz2 = `${field}${mrzCheckDigit(field)}GBR8001011M3001011<<<<<<<<<<<<<<04`.padEnd(44, '<');
  // The MRZ filler is `<`, which is also XML's one forbidden character in text.
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="white"/>
    <text x="${40 * scale}" y="${90 * scale}" font-family="Arial" font-size="${fs}" fill="black">PASSPORT</text>
    <text x="${40 * scale}" y="${180 * scale}" font-family="Arial" font-size="${fs}" fill="black">Passport No: ${xml(number)}</text>
    <text x="${40 * scale}" y="${500 * scale}" font-family="DejaVu Sans Mono, Consolas, Courier New, monospace" font-size="${fs}" letter-spacing="${Math.round(2 * scale)}" fill="black" xml:space="preserve">${xml(mrz1)}</text>
    <text x="${40 * scale}" y="${560 * scale}" font-family="DejaVu Sans Mono, Consolas, Courier New, monospace" font-size="${fs}" letter-spacing="${Math.round(2 * scale)}" fill="black" xml:space="preserve">${xml(mrz2)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function png(buffer, name = 'id.png') {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: 'image/png' }), name);
  return fd;
}
function pdf(documentType, salt) {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(`%PDF-1.4 e2e-ocr ${salt}`)], { type: 'application/pdf' }), 'd.pdf');
  fd.append('documentType', documentType);
  return fd;
}
function withType(fd, documentType) {
  fd.append('documentType', documentType);
  return fd;
}

async function main() {
  for (let i = 0; i < 30; i++) { try { await req('GET', '/health'); break; } catch { await sleep(1000); } }

  const admin = (await req('POST', '/auth/login', { body: { email: 'admin@propverify.local', password: 'Admin123!' } })).accessToken;
  const u = `${Date.now()}`.slice(-7);
  // Distinct per run so a leftover row from an aborted run cannot collide.
  const NUMBER = `P${u.slice(0, 6)}A`;
  const OTHER = `Q${u.slice(1, 7)}B`;
  const phones = { a: `+9053${u}1`, b: `+9053${u}2`, c: `+9053${u}3` };

  const agentA = await otp(phones.a, 'solo_agent');
  const agentB = await otp(phones.b, 'solo_agent');
  const agentC = await otp(phones.c, 'solo_agent');
  const idA = (await req('GET', '/users/me', { token: agentA })).id;
  const idB = (await req('GET', '/users/me', { token: agentB })).id;

  const bannedHere = [];

  /** Upload the three solo-agent profile documents; the ID is the given image. */
  async function uploadProfile(token, idImage, label) {
    await req('POST', '/users/me/profile/solo_agent/documents', { token, form: withType(png(idImage), 'government_id') });
    await req('POST', '/users/me/profile/solo_agent/documents', { token, form: pdf('real_estate_license', `${u}-${label}-lic`) });
    await req('POST', '/users/me/profile/solo_agent/documents', { token, form: pdf('selfie_with_id', `${u}-${label}-selfie`) });
  }
  async function queueItemFor(phone) {
    const queue = await req('GET', '/admin/verification/queue?entityType=profile', { token: admin });
    return queue.find((q) => q.summary?.lister === phone);
  }
  async function approve(item) {
    const detail = await req('GET', `/admin/verification/${item.id}`, { token: admin });
    return req('POST', `/admin/verification/${item.id}/decision`, {
      token: admin,
      body: { documentDecisions: detail.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
    });
  }

  try {
    // ── 1. the number is read off the upload ──────────────────────
    const cardA = await passportPng(NUMBER, 1.0);
    await uploadProfile(agentA, cardA, 'A');
    const docsA = await retry(
      () => req('GET', '/users/me/profile/solo_agent/documents', { token: agentA }),
      (docs) => docs.some((d) => d.documentType === 'government_id' && d.docNumber),
    );
    const idDocA = docsA.find((d) => d.documentType === 'government_id');
    ok('1a OCR read the document number off the identity upload', idDocA?.docNumber === NUMBER, JSON.stringify(idDocA?.docNumber ?? null));
    ok('1b a PDF gets no number, not a guess', docsA.find((d) => d.documentType === 'real_estate_license')?.docNumber == null);

    const itemA = await queueItemFor(phones.a);
    await approve(itemA);
    const rolesA = await req('GET', '/users/me/roles', { token: agentA });
    ok('1c the account verifies normally', rolesA.find((r) => r.role.key === 'solo_agent')?.verificationStatus === 'verified');

    // ── 2. ban, and the number goes on the list with the file ─────
    await req('POST', `/admin/users/${idA}/status`, { token: admin, body: { status: 'banned', reason: 'e2e OCR durability check' } });
    bannedHere.push(idA);

    // ── 3. same passport, different photograph ────────────────────
    // A larger render: every pixel differs, so the sha256 differs, so the
    // step-21 file-hash key sees nothing. Only the number connects them.
    const cardB = await passportPng(NUMBER, 1.3);
    ok('3a the second image is a different file', !cardA.equals(cardB) && cardA.length !== cardB.length);
    await uploadProfile(agentB, cardB, 'B');
    const docsB = await retry(
      () => req('GET', '/users/me/profile/solo_agent/documents', { token: agentB }),
      (docs) => docs.some((d) => d.documentType === 'government_id' && d.docNumber),
    );
    const readB = docsB.find((d) => d.documentType === 'government_id')?.docNumber ?? null;
    // Stated separately so a mismatch names the misread instead of just "[]".
    ok('3b′ the larger render reads the same number', readB === NUMBER, `A=${NUMBER} B=${readB}`);

    const itemB = await queueItemFor(phones.b);
    const detailB = await req('GET', `/admin/verification/${itemB.id}`, { token: admin });
    ok('3b the queue flags the banned identity from the NUMBER alone', detailB.profile.bannedIdentityMatch === true, `A=${NUMBER} B=${readB} signals=${JSON.stringify(detailB.profile.fraudSignals)}`);
    ok('3c and the signal says it was re-photographed, naming the banned account', detailB.profile.fraudSignals.some((s) => s.includes('DOCUMENT NUMBER') && s.includes(idA)), JSON.stringify(detailB.profile.fraudSignals));
    ok('3d while the file-hash signal, correctly, is silent', !detailB.profile.fraudSignals.some((s) => s.includes('same file')));

    const refused = await failMessage('POST', `/admin/verification/${itemB.id}/decision`, {
      token: admin,
      body: { documentDecisions: detailB.profile.documents.map((d) => ({ documentId: d.id, status: 'approved' })) },
    });
    ok('3e approval is refused outright', refused.includes('-> 400') && refused.includes('BANNED_IDENTITY'), refused.slice(0, 160));

    // ── 4. a different person is not caught in the net ────────────
    await uploadProfile(agentC, await passportPng(OTHER, 1.1), 'C');
    await retry(
      () => req('GET', '/users/me/profile/solo_agent/documents', { token: agentC }),
      (docs) => docs.some((d) => d.documentType === 'government_id' && d.docNumber),
    );
    const itemC = await queueItemFor(phones.c);
    const detailC = await req('GET', `/admin/verification/${itemC.id}`, { token: admin });
    ok('4a a different number raises no identity flag', detailC.profile.bannedIdentityMatch === false, JSON.stringify(detailC.profile.fraudSignals));
    await approve(itemC);
    const rolesC = await req('GET', '/users/me/roles', { token: agentC });
    ok('4b and approves normally', rolesC.find((r) => r.role.key === 'solo_agent')?.verificationStatus === 'verified');

    // Nothing legible: a blank card. Recorded as null, never as a guess.
    const blank = await sharp({ create: { width: 400, height: 260, channels: 3, background: 'white' } }).png().toBuffer();
    await req('POST', '/users/me/profile/solo_agent/documents', { token: agentC, form: withType(png(blank, 'blank.png'), 'government_id') });
    await sleep(4000);
    const docsC = await req('GET', '/users/me/profile/solo_agent/documents', { token: agentC });
    const blankDoc = docsC.find((d) => d.documentType === 'government_id' && d.docNumber == null);
    ok('4c an unreadable document records no number rather than a wrong one', !!blankDoc);

    // ── 5. reinstatement clears both keys ─────────────────────────
    await req('POST', `/admin/users/${idA}/status`, { token: admin, body: { status: 'active', reason: 'e2e reinstatement' } });
    bannedHere.length = 0;
    const afterB = await req('GET', `/admin/verification/${itemB.id}`, { token: admin });
    ok('5a lifting the ban clears the number-match too', afterB.profile.bannedIdentityMatch === false, JSON.stringify(afterB.profile.fraudSignals));
  } finally {
    for (const id of bannedHere) {
      await req('POST', `/admin/users/${id}/status`, { token: admin, body: { status: 'active', reason: 'e2e cleanup' } }).catch(() => undefined);
    }
  }

  console.log(results.join('\n'));
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL IDENTITY-OCR E2E CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('E2E ERROR:', e.message); process.exit(1); });
