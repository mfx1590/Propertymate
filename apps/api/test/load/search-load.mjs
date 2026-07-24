/**
 * Search load test (Plan §11 NFR: p95 search API < 300ms).
 * Fires concurrent GET /search/listings requests with varied params for a
 * fixed duration, then reports throughput and latency percentiles.
 *
 * Usage: node test/load/search-load.mjs [--conc=50] [--secs=15] [--base=http://localhost:4000]
 * Informational by default (does not fail CI); pass --strict to exit non-zero
 * if p95 exceeds the target.
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const BASE = args.base ?? process.env.API_BASE ?? 'http://localhost:4000';
const CONCURRENCY = Number(args.conc ?? 50);
const DURATION_MS = Number(args.secs ?? 15) * 1000;
const TARGET_P95 = 300;
const STRICT = Boolean(args.strict);

const REGIONS = ['kyrenia', 'famagusta', 'iskele', 'nicosia', 'guzelyurt', 'lefke', ''];
const KINDS = ['resale', 'rental', ''];
const DEEDS = ['turkish', 'exchange', 'allocation', 'foreign', ''];
const SORTS = ['newest', 'price_asc', 'price_desc'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function randomQuery() {
  const p = new URLSearchParams();
  const r = pick(REGIONS); if (r) p.set('region', r);
  const k = pick(KINDS); if (k) p.set('kind', k);
  const d = pick(DEEDS); if (d) p.set('deedType', d);
  if (Math.random() > 0.5) p.set('minBeds', String(1 + Math.floor(Math.random() * 4)));
  if (Math.random() > 0.5) p.set('maxPrice', String([100000, 200000, 350000, 500000][Math.floor(Math.random() * 4)]));
  p.set('sort', pick(SORTS));
  p.set('page', String(1 + Math.floor(Math.random() * 2)));
  return p.toString();
}

const latencies = [];
let ok = 0, errors = 0, stop = false;

async function worker() {
  while (!stop) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}/search/listings?${randomQuery()}`);
      await res.text();
      const dt = performance.now() - t0;
      if (res.ok) { latencies.push(dt); ok++; } else errors++;
    } catch {
      errors++;
    }
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

(async () => {
  // wait for API
  for (let i = 0; i < 20; i++) { try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  // warm-up
  await Promise.all(Array.from({ length: 10 }, () => fetch(`${BASE}/search/listings`).then((r) => r.text()).catch(() => {})));

  console.log(`Load test: ${CONCURRENCY} concurrent workers for ${DURATION_MS / 1000}s against ${BASE}`);
  const start = performance.now();
  const workers = Array.from({ length: CONCURRENCY }, worker);
  setTimeout(() => { stop = true; }, DURATION_MS);
  await Promise.all(workers);
  const elapsed = (performance.now() - start) / 1000;

  latencies.sort((a, b) => a - b);
  const total = ok + errors;
  const rps = Math.round(ok / elapsed);
  const p50 = pct(latencies, 50), p95 = pct(latencies, 95), p99 = pct(latencies, 99);
  const mean = latencies.reduce((s, x) => s + x, 0) / (latencies.length || 1);

  console.log('\n── Results ─────────────────────────────');
  console.log(`requests:    ${total} (ok ${ok}, errors ${errors})`);
  console.log(`throughput:  ${rps} req/s`);
  console.log(`latency ms:  mean ${mean.toFixed(1)} | p50 ${p50.toFixed(1)} | p95 ${p95.toFixed(1)} | p99 ${p99.toFixed(1)} | max ${latencies[latencies.length - 1]?.toFixed(1)}`);
  console.log(`target:      p95 < ${TARGET_P95}ms — ${p95 < TARGET_P95 ? 'PASS ✓' : 'MISS ✗'}`);

  if (STRICT && (p95 >= TARGET_P95 || errors > 0)) process.exit(1);
})();
