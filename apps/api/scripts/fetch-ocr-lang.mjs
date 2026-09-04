/**
 * Vendor the Tesseract English language data for local OCR (step 28).
 *
 * tesseract.js will fetch this itself on first use if it is missing — but
 * "first use" is somebody's identity upload, and a 4MB download on that
 * request path (or in a container with no egress) is not where this should
 * happen. Run once per machine, in CI, and in the Docker build.
 *
 * `tessdata_fast` on purpose: the MRZ is OCR-B at a fixed layout, where the
 * fast model reads as well as the best one and loads in a third of the time.
 * Node's own fetch is used because curl is not in node:20-bookworm-slim.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = process.env.OCR_LANG_PATH ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'ocr');
const FILE = join(DIR, 'eng.traineddata');
const URL = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata';

if (existsSync(FILE) && statSync(FILE).size > 1_000_000) {
  console.log(`ocr: ${FILE} already present (${(statSync(FILE).size / 1e6).toFixed(1)} MB)`);
  process.exit(0);
}

mkdirSync(DIR, { recursive: true });
const res = await fetch(URL);
if (!res.ok) {
  console.error(`ocr: download failed ${res.status} ${res.statusText}`);
  process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
writeFileSync(FILE, bytes);
console.log(`ocr: wrote ${FILE} (${(bytes.length / 1e6).toFixed(1)} MB)`);
