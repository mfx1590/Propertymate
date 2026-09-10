/**
 * OCR probe — what does THIS machine's rendering + Tesseract actually read?
 *
 * Renders the same synthetic passport page the identity-OCR e2e suite uses,
 * at the same two scales, and prints the raw MRZ lines Tesseract returned
 * beside what the extractor made of them. It exists because the runner's
 * fonts differ from a developer's: a card that read cleanly on Windows read
 * a different glyph on Ubuntu, and nothing in a failing e2e said what the
 * engine had seen. CI runs this before the suites so the evidence is in the
 * log every time; run it locally with `npm run ocr:probe -w apps/api`.
 *
 * Requires a built API (`dist/`) and the language data (`ocr:fetch`).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..');
const require = createRequire(join(apiRoot, 'package.json'));
const sharp = require('sharp');
const { OcrService } = require(join(apiRoot, 'dist/common/ocr/ocr.service.js'));

process.env.OCR_LANG_PATH ??= join(apiRoot, 'ocr');
const ocr = new OcrService(null);

function mrzCheckDigit(field) {
  const w = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    const ch = field[i];
    sum += (ch === '<' ? 0 : /[0-9]/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55) * w[i % 3];
  }
  return sum % 10;
}

// Keep in step with identity-ocr-flows.mjs — same card, same fonts.
async function passportPng(number, scale) {
  const w = Math.round(1000 * scale), h = Math.round(640 * scale), fs = Math.round(38 * scale);
  const field = number.padEnd(9, '<');
  const mrz1 = 'P<GBRDOE<<JOHN<ANDREW<<<<<<<<<<<<<<<<<<<<<<<<'.padEnd(44, '<');
  const mrz2 = `${field}${mrzCheckDigit(field)}GBR8001011M3001011<<<<<<<<<<<<<<04`.padEnd(44, '<');
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="white"/>
    <text x="${40 * scale}" y="${90 * scale}" font-family="Arial" font-size="${fs}" fill="black">PASSPORT</text>
    <text x="${40 * scale}" y="${180 * scale}" font-family="Arial" font-size="${fs}" fill="black">Passport No: ${xml(number)}</text>
    <text x="${40 * scale}" y="${500 * scale}" font-family="Courier New, Liberation Mono, monospace" font-size="${fs}" fill="black" xml:space="preserve">${xml(mrz1)}</text>
    <text x="${40 * scale}" y="${560 * scale}" font-family="Courier New, Liberation Mono, monospace" font-size="${fs}" fill="black" xml:space="preserve">${xml(mrz2)}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const numbers = ['P198961A', 'P085175A', 'Q005111A'];
let failures = 0;
console.log(`ocr-probe on ${process.platform} — lang from ${process.env.OCR_LANG_PATH}`);
for (const n of numbers) {
  for (const scale of [1.0, 1.3]) {
    const text = await ocr.recognise(await passportPng(n, scale));
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, '')).filter(Boolean);
    const mrz = lines.filter((l) => l.length >= 28 && l.includes('<'));
    const visual = lines.find((l) => /NO[:.]?/i.test(l)) ?? '';
    const got = ocr.extractDocumentNumber(text);
    const verdict = got === n ? 'OK  ' : 'MISS';
    if (got !== n) failures++;
    console.log(`${verdict} ${n} @${scale}  → ${got ?? 'null'}   visual="${visual.slice(0, 24)}"  mrz2="${(mrz[1] ?? mrz[0] ?? '').slice(0, 14)}"`);
  }
}
await ocr.onModuleDestroy();
console.log(failures ? `ocr-probe: ${failures} miss(es) — see raw reads above` : 'ocr-probe: every card read correctly');
// The probe informs; it does not gate. The e2e suite is the gate.
process.exit(0);
