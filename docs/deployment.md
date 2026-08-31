# Deploying PropVerify

This describes a **single-VPS test deployment**: everything on one box, run by
Docker Compose, with Caddy terminating TLS.

> **Hostinger note.** This will not run on Hostinger's shared/Cloud web hosting
> or on their Git "framework preset" deploy screen. Those host one built app —
> PropVerify is two long-running Node servers plus PostgreSQL, Redis,
> Meilisearch and object storage. You need a **VPS** (KVM 2 / 8 GB is
> comfortable; KVM 1 / 4 GB will run it but Meilisearch and Postgres will be
> tight). Choose the Ubuntu 24.04 + Docker template and you can skip step 2.

---

## 1. DNS

Point all three records at the VPS IP **before** you deploy — Caddy requests
certificates on first boot and needs the names to resolve.

| Type | Name | Value |
|---|---|---|
| A | `@` | your VPS IP |
| A | `www` | your VPS IP |
| A | `api` | your VPS IP |

The app sits on the **apex** so the listing pages — the SEO surface (§1) —
live on the brand hostname. `www` is required, not optional: the Caddyfile
redirects it to the apex, and Caddy requests a certificate for every site it
is given at boot, so a missing `www` record produces repeated failures. If you
would rather run the app on `app.<domain>`, set `APP_DOMAIN` to that, drop the
`www` record, and delete the `www.{$APP_DOMAIN}` block from the Caddyfile.

Giving the API its own hostname keeps browser requests same-site and lets Caddy
serve listing photos from `api.<domain>/media` without exposing MinIO.

## 2. Server prerequisites

```bash
curl -fsSL https://get.docker.com | sh
```

## 3. Get the code and configure

The repository is private, so HTTPS will prompt for credentials. Use a
read-only **deploy key** rather than putting an account-wide token on a
public-facing box:

```bash
ssh-keygen -t ed25519 -C "propertymate-vps" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add that key at repo → Settings → Deploy keys, leaving **write access
unchecked** — the server only ever pulls. The key has no passphrase so that
`git pull` runs unattended, which is exactly why it must be read-only.

```bash
git clone git@github.com:mfx1590/Propertymate.git && cd Propertymate
cp .env.production.example .env.production
```

Edit `.env.production`. All five `CHANGE_ME` placeholders must be replaced,
each with its own value:

```bash
for k in POSTGRES_PASSWORD MEILI_MASTER_KEY S3_SECRET_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do sed -i "s|^$k=CHANGE_ME$|$k=$(openssl rand -base64 32)|" .env.production; done
```

Verify none were missed — this should print nothing:

```bash
grep CHANGE_ME .env.production
```

Set `APP_DOMAIN` and `API_DOMAIN` to the hostnames from step 1. Leave
`OTP_PROVIDER=mock` for a test deployment: there is no SMS provider wired up, so
mock is the only way to sign in — codes are printed to the API log.

## 4. First deploy

Seed the database on the very first run only:

```bash
SEED_ON_BOOT=true docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

This creates the roles, permissions, verification requirements, regions,
pipeline templates and the admin account. Then set `SEED_ON_BOOT=false` in
`.env.production` so later restarts skip it.

Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

The API applies its own migrations on boot, so there is no separate migrate
step. Once healthy:

- app → `https://<your-domain>`
- API health → `https://api.<your-domain>/health/ready`

## 5. Sign in

The seeded admin is `admin@propverify.local` / `Admin123!`.

**Change that password before the box is reachable by anyone else** — it is a
published default, and it holds every admin permission.

For phone sign-in, request a code in the UI and read it from the log:

```bash
docker compose -f docker-compose.prod.yml logs api | grep "OTP for"
```

## 6. Optional: demo data

Fifty listings across all regions, with photos, indexed for search:

```bash
docker compose -f docker-compose.prod.yml exec api npm run db:demo -w apps/api
```

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations apply automatically on API start.

> **If the API hostname changes**, the web image must be rebuilt, not just
> restarted: `NEXT_PUBLIC_API_URL` is compiled into the client bundle at build
> time. `--build` handles this.

## Backups

The data lives in Docker volumes. At minimum, dump Postgres on a schedule:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U propverify propverify | gzip > backup-$(date +%F).sql.gz
```

Meilisearch can be rebuilt from Postgres at any time
(`POST /search/reindex` as an admin), so it does not need backing up.

## What this setup is not

Being explicit, since this is a test deployment:

- **No horizontal scaling.** One API container. The BullMQ jobs assume they can
  run on any instance, but nothing is load balanced.
- **MinIO holds the documents.** It is on the same disk as the database, with
  no replication. Move `S3_*` to Cloudflare R2 before this carries anything
  real — the storage layer is plain S3, so it is env vars only, no code change.
- **No off-site backups** until you add them.
- **Error tracking is off** unless `SENTRY_DSN` is set.
- **Email and WhatsApp are inert** unless their keys are set; notifications
  record a "skipped" delivery and carry on. In-app notifications work regardless.
