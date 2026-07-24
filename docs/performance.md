# Search performance — load test (Phase 1 hardening)

Plan §11 NFR: **p95 search API < 300 ms**.

## How to run
```bash
docker compose up -d --wait
npm run db:seed && npm run db:demo      # ~50 indexed listings
npm run dev -w apps/api                 # or: node apps/api/dist/main.js
npm run test:load -w apps/api           # add --conc=100 --secs=30 --strict to tune / gate
```
The test ([apps/api/test/load/search-load.mjs](../apps/api/test/load/search-load.mjs)) fires
concurrent `GET /search/listings` requests with randomised filters (region, kind, deed, beds,
price, sort, page) so results aren't trivially cached, then reports throughput + latency
percentiles. Informational by default; `--strict` exits non-zero if p95 ≥ 300 ms or any request errors.

## Baseline result (2026-07-24, dev laptop: Windows, Dockerised Postgres/Meilisearch, 50 workers × 15 s)
```
requests:    3613 (ok 3613, errors 0)
throughput:  239 req/s
latency ms:  mean 208.7 | p50 201.3 | p95 268.2 | p99 393.2 | max 558.9
target:      p95 < 300ms — PASS ✓
```
Production (dedicated infra, connection pooling, a CDN in front of media) will do better; this is
a loaded single-node dev box and already clears the NFR.

## Finding fixed during load testing
The global 120 req/min throttle was being applied to the public **browse** endpoints, so under load
~99% of search requests returned 429. Per §11 (rate-limit **auth/chat/inquiry**, not browse), the
public `GET /search/listings` and `GET /properties/:id` are now `@SkipThrottle()`-exempt; the tight
per-endpoint limits on auth/OTP/inquiry/chat are unchanged.

## Notes / deferred
- Error tracking (Sentry): the global exception filter centralises 5xx logging with request ids —
  that is the single hook point for `Sentry.captureException`. SDK wire-up is deferred to deployment
  (needs a DSN); `SENTRY_DSN` is already in `.env.example`.
