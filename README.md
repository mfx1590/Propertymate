# PropVerify — Verified Property Ecosystem (Northern Cyprus)

Trust-first real estate super app for the TRNC. Every property, agent, agency and developer is
document-verified before going live. Covers the full journey: discovery → viewing → offer →
contract → completion → post-deal services.

> Master specification: [Plan.md](./Plan.md). Deployment runbook: [DEPLOY.md](./DEPLOY.md). The codebase is name-agnostic (`propverify` is a working name).

## Repo layout (Turborepo + npm workspaces)

```
apps/
  api/          NestJS modular monolith (Prisma, PostgreSQL, Redis, Meilisearch)
  web/          Next.js App Router (SSR for SEO), next-intl (EN/TR live, RU/FA stubbed, RTL-ready)
  mobile/       (Phase 2 — Expo, consumes the same API)
packages/
  shared/       Domain enums, permission keys, pipeline stage types — single source of truth
  ui/           Shared React primitives (grows into the design system)
```

## Getting started

```bash
# 1. infrastructure (postgres, redis, meilisearch, minio + bucket init)
docker compose up -d

# 2. env
cp .env.example .env            # defaults match docker-compose
cp .env.example apps/api/.env   # prisma reads DATABASE_URL from apps/api/.env

# 3. install + database
npm install
npm run db:migrate              # creates schema (prisma migrate dev)
npm run db:seed                 # roles, permissions, requirements, regions, pipeline templates, admin

# 4. run everything
npm run dev                     # turbo: api on :4000, web on :3000
```

Dev super admin: `admin@propverify.local` / `Admin123!` (seeded — change in production).
OTP codes are logged by the API and returned as `devCode` while `OTP_PROVIDER=mock`.

## Architecture cornerstones (do not violate)

1. **Roles are data, not code branches.** Permissions live in the DB (`roles`, `permissions`,
   `role_permissions`); endpoints declare `@RequirePermissions('listing.create')` and the guard
   checks the DB, deny-by-default. Never write `if (user.role === 'lawyer')`.
2. **Verification requirements are config.** The `verification_requirements` table drives both
   the upload UI and the admin checklist.
3. **The deal pipeline is config.** `pipeline_templates.stages` (JSON) declares stage order,
   required documents, who completes each stage, and which `service_type`s can be injected —
   this is how lateral roles (lawyer, movers…) plug into deals without core changes.
4. **Audit everything.** Mutations on users, documents, verifications, listings and deals call
   `AuditService.log()` — append-only, no update/delete path.
5. **Documents are private.** Documents bucket is never public; access via short-lived signed
   URLs behind permission checks. Media bucket is public CDN.
6. **Soft deletes everywhere** (`deleted_at`); hard deletes only via the admin retention job.

## How to add a lateral role (e.g. Lawyer) — zero core changes

1. Seed a row in `roles` + its permission rows in `permissions` / `role_permissions`.
2. Create a `lawyer_profiles` table (1:1 to users) + migration.
3. Seed its `verification_requirements` (e.g. bar license → one row).
4. Register a dashboard module for the role in the web app's role-module registry.
5. If it participates in deals: add the `service_type` and declare which pipeline stages accept
   it in `pipeline_templates.stages[].injectableServiceTypes`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run api + web in watch mode (via turbo) |
| `npm run build` | Build all workspaces |
| `npm run typecheck` | TypeScript checks across the monorepo |
| `npm run test` | Run tests |
| `npm run db:migrate` | Prisma migrate dev (apps/api) |
| `npm run db:seed` | Seed roles/permissions/requirements/regions/templates/admin |

## Status

Phase 1 foundation (Plan §10.1) — scaffold, schema, seeds, auth (OTP mock + rotating JWT),
RBAC guard, audit service, i18n web shell. Next: listings module + media pipeline + search.
