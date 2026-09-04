# Deploying PropVerify

The complete runbook for the single-VPS deployment on `propertymate.tech`
(Hostinger KVM 2, Docker Compose, Caddy for TLS). It replaces
`docs/deployment.md`, which now just points here.

Two kinds of reader: **first deployment** (sections 1–5), and **updating the
live box** (section 6 — which is what you need right now: the VPS is ten
commits and five migrations behind `main`).

---

## 0. What you need before starting

| | |
|---|---|
| A VPS | Ubuntu 24.04 with Docker (Hostinger's "Ubuntu + Docker" template). KVM 2 / 8 GB is comfortable; KVM 1 / 4 GB runs it but Postgres and Meilisearch are tight. Shared/Cloud hosting cannot run this — it is two Node servers plus Postgres, Redis, Meilisearch and object storage. |
| Three DNS A records | `@`, `www`, `api` → the VPS IP. All three, **before** the first boot — Caddy requests certificates for every hostname at startup and fails loudly on a name that does not resolve. |
| A read-only deploy key | So the box can `git pull` unattended without an account-wide token on it. |
| Five secrets | Generated on the box with `openssl rand -base64 32`, one each. |
| Outbound internet at build time | `npm ci` and — since step 28 — a 4 MB Tesseract language file are fetched while the image builds. The running containers need no egress. |

**Nothing else is required.** Email, WhatsApp and error tracking are optional
keys; without them the features degrade to a recorded "skipped", never a
failure.

---

## 1. Server prerequisites

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. Code and deploy key

```bash
ssh-keygen -t ed25519 -C "propertymate-vps" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add that key at **GitHub → repo → Settings → Deploy keys**, with *write
access unchecked*. The key has no passphrase so `git pull` runs unattended,
which is exactly why it must be read-only.

```bash
git clone git@github.com:mfx1590/Propertymate.git ~/Propertymate
cd ~/Propertymate
cp .env.production.example .env.production
```

## 3. Configure `.env.production`

Replace all five `CHANGE_ME` placeholders, each with its own value:

```bash
for k in POSTGRES_PASSWORD MEILI_MASTER_KEY S3_SECRET_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do sed -i "s|^$k=CHANGE_ME$|$k=$(openssl rand -base64 32)|" .env.production; done
```

This must print nothing:

```bash
grep CHANGE_ME .env.production
```

Then set the domains and read the notes on the rest:

| Variable | Set to | Notes |
|---|---|---|
| `APP_DOMAIN` | `propertymate.tech` | The apex — listing pages are the SEO surface. `www` redirects to it. |
| `API_DOMAIN` | `api.propertymate.tech` | Photos are served through `api.<domain>/media` so MinIO is never exposed. |
| `OTP_PROVIDER` | `mock` | No SMS provider is wired. Codes are printed to the API log (see §5). |
| `SEED_ON_BOOT` | `true` **for the very first boot only**, then `false` | Seeds roles, permissions, requirements, regions, pipelines, admin. |
| `RESEND_API_KEY`, `EMAIL_FROM` | your Resend key, `PropVerify <noreply@propertymate.tech>` | **Still unset on the live box.** Until set, every email notification is recorded as `skipped` and reaches in-app only. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Meta Cloud API credentials | Also requires the templates in `apps/api/src/modules/notifications/templates.ts` to be registered with Meta in EN/TR/RU/FA. Inert until then. |
| `SENTRY_DSN` | optional | Error tracking is off without it. |
| `LOG_LEVEL` | `info` | |

Things that are **not** in the file and must stay out of it:

- `AUTH_THROTTLE_BYPASS` — the CI/e2e switch that turns rate limiting off. The
  production image bakes `NODE_ENV=production` and the guard ignores the flag
  under it, so it cannot take effect on the VPS even if set. Don't set it.
- `NEXT_PUBLIC_SITE_URL` — the sitemap and robots default to
  `https://propertymate.tech`. Only if the brand domain ever changes does this
  need passing as a build arg to the web image.
- `OCR_LANG_PATH` — the language file is baked into the image at build.

## 4. First boot

```bash
SEED_ON_BOOT=true docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Then set `SEED_ON_BOOT=false` in `.env.production`. Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

The API applies its own migrations on every start (`prisma migrate deploy` in
the entrypoint), so there is never a separate migrate step. Healthy when:

- `https://propertymate.tech` renders the homepage
- `https://api.propertymate.tech/health/ready` returns `{"status":"ready","deps":{"db":"up","meilisearch":"up","storage":"up"}}`

## 5. Sign in, and change the admin password

The seeded admin is `admin@propverify.local` / `Admin123!`. That password is
in a public repository. Change it before anything else — there is no
password-change screen, so do it directly (bcryptjs is in the API image):

```bash
HASH=$(docker compose -f docker-compose.prod.yml exec -T api node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'YOUR-NEW-PASSWORD')
docker compose -f docker-compose.prod.yml exec -T postgres psql -U propverify -d propverify -c "update users set password_hash='$HASH' where email='admin@propverify.local';"
```

Phone sign-in: request a code in the UI, then read it from the log:

```bash
docker compose -f docker-compose.prod.yml logs api | grep "OTP for"
```

---

## 6. Updating the live box — do this now

The VPS was last deployed at `5eff395`. Since then: ten commits, five
migrations (lawyer marketplace, plan pricing + payment ledger, market
snapshots, dispute statements, document-number OCR), all applied
automatically on boot. Everything after the `up` is what makes the new
features visible.

```bash
cd ~/Propertymate && git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

**Re-run the seed.** It is idempotent, and it is required: it writes the
Russian and Farsi region names that the original seed left as English, adds
the `lawyer` role and its bar-licence requirement, and the `legal.quote`
permission. Without it the lawyer signup option 500s and Russian readers see
"Kyrenia".

```bash
docker compose -f docker-compose.prod.yml exec api npm run db:seed -w apps/api
```

**Demo data** (optional, recommended for looking at the site): fifty listings
across every region and price band, with photos, indexed for search.

```bash
docker compose -f docker-compose.prod.yml exec api npm run db:demo -w apps/api
```

**Take the first market snapshot.** The insights pages are empty until one
exists; the scheduler only runs on the 1st of the month. Get an admin token
and trigger it:

```bash
TOKEN=$(curl -s -X POST https://api.propertymate.tech/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@propverify.local","password":"YOUR-ADMIN-PASSWORD"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl -s -X POST https://api.propertymate.tech/admin/jobs/market-snapshot -H "Authorization: Bearer $TOKEN"
```

Expected: `{"month":"2026-09","regions":6}`.

**Rebuild the search index** (cheap, idempotent — the index gained fields in
steps 14 and 22):

```bash
curl -s -X POST https://api.propertymate.tech/search/reindex -H "Authorization: Bearer $TOKEN"
```

## 7. What to look at afterwards

Eighteen features have landed since anyone last saw the site. In the order
they are quickest to check:

| Page | What should be there |
|---|---|
| `/en/search` → **Map** | *Draw area* traces a polygon that filters the results; *Show:* toggles universities, beaches, hospitals. Try `/fa/search` too — it is RTL. |
| any listing page | *What's nearby* — nearest university, beach and hospital with distances. Instalment calculator. Currency switcher (`≈` prefix on converted prices). |
| `/en/insights?region=kyrenia` | Tiles and the month table — **after** the snapshot trigger above. |
| `/en/valuation` | An estimate range from comparables; refuses under five. |
| `/en/lawyers` | Empty until a lawyer registers — sign up a test account choosing *Lawyer* at `/en/auth`, upload three documents, approve it in the admin queue, and it appears. |
| `/en/region/kyrenia` | Landing page with medians and the deed-type breakdown; titles localised in `/ru/` and `/fa/`. |
| Admin → **Subscriptions** | Plan prices (all "not priced yet" — yours to set), the grant form with the payment block, the money record. |
| Admin → **Audit log** | Every action since first boot, filterable; *Export this view*. |
| Admin → **Data exports** | Seven CSVs with live counts. Open one in Excel — Turkish and Cyrillic must render. |
| Admin → **Disputes** | Empty until a deal exists. Demo data makes listings, not deals. |
| Admin → **Verification queue** → an identity document | `No. … (read by OCR)` beside the scan, when the number was legible. |

What will **not** work yet, and why:

- **Email notifications** — `RESEND_API_KEY` unset. In-app and push work.
- **WhatsApp** — credentials and Meta template approval both outstanding.
- **Lawyer engagement, disputes, contracts** need a real deal; the quickest
  path to one is a developer project with a unit, reserved by a customer
  account (that creates an off-plan deal at `legal_check`).
- **Farsi contract PDFs** — dropped as scope on 2026-09-03; a Farsi reader gets
  the English document with a banner saying so.

---

## Operations

**Backups.** Everything lives in Docker volumes. At minimum, dump Postgres on
a schedule; Meilisearch can always be rebuilt from it (`/search/reindex`).

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U propverify propverify | gzip > backup-$(date +%F).sql.gz
```

**Logs.** `docker compose -f docker-compose.prod.yml logs -f api` — structured
JSON via pino, request ids on every line. A boot line reading
`AUTH_THROTTLE_BYPASS is set` should never appear in production.

**If the API hostname changes**, the web image must be *rebuilt*, not
restarted: `NEXT_PUBLIC_API_URL` is compiled into the client bundle.
`--build` handles it.

**Scheduled jobs** run inside the API container on BullMQ: daily freshness,
mandate expiry, rating reveal, reputation, recommendations, featured expiry,
saved-search and price-drop alerts; monthly market snapshot on the 1st at
04:45. Nothing needs cron on the host.

## What this setup is not

- **No horizontal scaling.** One API container.
- **MinIO holds the documents** on the same disk as the database, unreplicated.
  Move `S3_*` to Cloudflare R2 before this carries anything real — the storage
  layer is plain S3, so it is env vars only.
- **No off-site backups** until you add them.
- **No payment collection.** Subscriptions are admin-granted and the ledger
  records what was collected offline; card acquiring, success-fee invoicing
  and escrow wait on the provider and legal conversations (see the
  escrow scoping brief noted in Plan.md §0).
