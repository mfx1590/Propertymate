# PLAN.md — Verified Property Ecosystem (Northern Cyprus Real Estate Super App)

> **Instruction to Claude Code:** This document is the master build specification. Follow it phase by phase.
> Do not skip the architectural rules in §2 — the entire product depends on the modular role system
> and the verification engine being built correctly from the start.

---

## 0. Status & Change Log (living section — keep updated)

> **Rule:** whenever a build step is completed, mark it here with the date. Whenever a role,
> requirement, or any spec detail is changed on request, record the change in the Change Log
> below AND update the relevant § of this document. This section is the single answer to
> "where are we and where are we going."

### Build status (Phase 1 — MVP, §10.1)

| # | Step | Status | Date | Notes |
|---|---|---|---|---|
| 1 | Foundation: monorepo, Docker infra, Prisma schema §5, seeds, auth (OTP mock + rotating JWT), RBAC guard, audit service, CI | ✅ **Done** | 2026-07-10 | Turborepo + **npm workspaces** (no pnpm on dev machine). Auth flows, refresh rotation + reuse detection, audit rows, and EN/TR/FA-RTL rendering verified live. Dev admin: `admin@propverify.local` |
| 2 | Roles & profiles: per-role registration, profile extensions, role-module dashboard shell, i18n EN/TR | ✅ **Done** | 2026-07-10 | Apply-for-role API (owner instant, professional roles `pending`), per-role profile CRUD with strict field whitelists, requirements served from config, web auth (OTP + email, auto-refresh tokens), dashboard shell with nav from typed role-module registry (§2.2). Verified over HTTP incl. field-injection + admin-apply rejection |
| 3 | Listings: wizard, media pipeline (EXIF/phash), document upload from config, Meilisearch sync, map search, detail page SSR, favorites, saved searches | ✅ **Done** | 2026-07-11 | 6-step wizard (kind → details → map-pin location → features → photos → config-driven doc boxes → review), sharp pipeline (EXIF strip, thumbnails, aHash dedupe warning across listings), private-bucket docs + 5-min signed URLs (stranger access verified denied), FX→GBP base pricing, submit validation, event-driven Meilisearch sync, filtered search + Leaflet map view, SSR detail with schema.org JSON-LD, favorites, saved searches. Temporary admin approve endpoint until step 4. 15-check API e2e green |
| 4 | Verification engine: queue, admin dashboard, signed-URL doc viewer, decisions, freshness job | ✅ **Done** | 2026-07-11 | Admin queue (SLA timers, claim, listing/profile filters, metrics), review screen with 5-min signed doc URLs + VERIFICATION COPY overlay, per-document approve/reject with §4 reason codes, fraud signals (sha256 reuse across accounts, phash photo dupes, ±40% price/m² anomaly), profile verification for professional roles, rejected-doc re-upload auto-requeues, in-app notifications, 90-day freshness cron (nudge 83/88, pause 90; @nestjs/schedule now, BullMQ in hardening). 11-check e2e green incl. full reject→re-upload→approve cycle and pause→confirm→relist |
| 4b | Marketplace core (§13): platform settings (agent count, profit bands, resale-mode toggle), subscription gating (admin-granted), find-my-agent private resale flow with owner-anonymous agent assignment, agent commission + publish, main-admin mediated-listings board | ✅ **Done** | 2026-07-12 | Resale approval now → `verified_private` (rentals unchanged). Owner picks up to N agents (admin-set) for 1–6mo; agent payloads verified to contain zero owner contact; accept/reject; publish computes list = ask + band + commission (buyer-pays), indexes at final price; public API hides the breakdown; admin boards for mediated listings (with projected profit), subscriptions (grant/revoke by email/phone) and live-editable settings + profit bands; assignment expiry cron. 12-check e2e green |
| 5 | Chat + viewings + offers (scrubbing incl. social-media handles per §13.6) | ✅ **Done** | 2026-07-12 | Per-property inquiry threads (mediated listings route to the publishing agent, never the owner); scrub service masks phones/emails/@handles/t.me/wa.me/social mentions with every attempt audited; contact reveals only after confirmed viewing or accepted offer; owner↔agent channel ALWAYS scrubbed (🔒); viewing scheduler with host/customer state machine; offer → counter → accept flow locking listing to under_offer + de-indexing; in-app notifications for all events; messages/viewings/offers pages + action box on listing detail. Realtime is 4s polling for now — Socket.io upgrade in hardening. 11-check e2e green |
| 6 | Deals v1: pipeline engine, deal rooms, journey tracker, snapshots, ratings | ✅ **Done** | 2026-07-16 | On offer-accept, deal built from `pipeline_templates` (§7): frozen DealSnapshot (agreed price + ask/fee/commission split), parties (buyer/seller/seller-side agent), stages (pre-acceptance auto-completed, next active), deal-room conversation, immutable DealEvent timeline. Stage engine enforces `completesBy` + required-doc attachment; skippable stages (permit_process); completion → property sold/rented. Ratings post-completion with §6.5 both-submit-or-14-days reveal (nightly cron) feeding agent reputation; interaction-gated public reviews (§13.2). Web: deals list + deal room with visual journey tracker, per-stage doc upload, advance/skip, star+tags rating form. 16-check e2e green (accept→snapshot→advance→doc-gated stage→skip→complete→sold→reciprocal reveal→reviews→timeline) |
| 7 | Hardening: rate limits, e2e tests, load test, security pass, 50 demo listings | ✅ **Done** | 2026-07-24 | **Done:** 50-listing demo seed (`npm run db:demo`) across all regions/kinds/deed-types/price bands with photos + Meilisearch reindex; admin `POST /search/reindex`; security/RBAC audit of all 87 routes ([docs/security-audit.md](docs/security-audit.md)) — fixed 2 public-payload leaks (property internal IDs breaking §13.4 anonymity; review `raterId`), verified deny-by-default coverage + rate limits; observability — pino structured logging w/ request-ids + secret redaction, global exception filter (consistent error shape, no stack leak), `/health/ready` readiness probe (DB + Meilisearch + storage), graceful shutdown hooks; **Socket.io realtime chat** — JWT-authed gateway, participant-checked conversation rooms, live message + inbox-notify delivery (4s polling replaced by a 30s reconnection-only fallback), decoupled via domain events; **BullMQ** — the 3 daily jobs (freshness sweep, assignment expiry, rating reveal) moved off @nestjs/schedule onto a Redis-backed `maintenance` queue with repeatable schedulers + a single worker, so each runs exactly once across instances (admin endpoints still trigger on demand); **e2e suite** — committed self-contained integration test ([apps/api/test/e2e/critical-flows.mjs](apps/api/test/e2e/critical-flows.mjs), `npm run test:e2e`, 16 checks) covering all 5 critical flows woven into one scenario (register+verify agent → publish+verify listing via find-my-agent → search→viewing → offer→deal completion+ratings → admin queue), plus a CI `e2e` job that stands up the full stack via docker compose, migrates+seeds, boots the API and runs it; **load test** — `npm run test:load` ([docs/performance.md](docs/performance.md)) hits public search with randomised filters, baseline **p95 268 ms / 239 req/s / 0 errors** clears the §11 <300 ms NFR; found + fixed a throttle misfire (global 120/min was capping public browse — search + property detail are now `@SkipThrottle`-exempt, tight limits kept on auth/chat/inquiry). **Deferred to deployment:** Sentry SDK wire-up (exception filter is the hook, `SENTRY_DSN` env ready) — everything else in §10.1 step 7 complete. **Phase 1 MVP complete.** |

**Where the code stands:** schema (all §5 tables) migrated + seeded (6 roles, 30 permissions,
21 verification requirements, 6 regions, purchase + rental pipeline templates). API boots on :4000,
web on :3000. `docker compose up -d` → `npm install` → `npm run db:migrate && npm run db:seed` → `npm run dev`.

### Change Log (spec/role/requirement changes made on request)

| Date | Change | Requested by | Sections touched |
|---|---|---|---|
| 2026-07-10 | Initial build started from this spec; added this Status & Change Log section as a living tracker | Mehdi | §0 (new) |
| 2026-07-10 | **Account type is chosen at registration**, not self-service from the dashboard. Signup (OTP or email) offers Customer / Owner / Solo Agent / Agency / Developer; everyone still gets the customer baseline, professional types start `pending`. The dashboard "Add a role" cards and the `POST /users/me/roles` endpoint were removed; granting additional roles later is an admin action. Multi-role support in the data model (§2.2) is unchanged. | Mehdi | §2.2 (note), §10.1 step 2 |
| 2026-07-12 | **Major mechanics expansion** (full detail in new §13): (a) Developer & Agency become **organization accounts** — an org admin manages member accounts (create/edit/remove), members maintain portfolio/listings; (b) professional **analytics dashboards** incl. developer project comparison within and across regions; (c) **public performance stats** per agency member + agency totals (rents/sales counts); (d) **profile reviews** writable by users, non-deletable by the profile owner, report → admin moderation → warnings → identity-backed ban; (e) **star/reward tiers** from performance data (rules TBD, future update); (f) **subscription-gated listing uploads**, tiered subscriptions per user type, higher tiers unlock premium properties (details TBD); (g) **Find-my-agent private resale flow** — verified resale stays non-public, owner assigns N agents (N admin-configurable, default 2–3) for 1–6 months, agents accept/reject, reassignment after expiry; (h) **platform profit bands by price range**, fully admin-configurable, agent adds own commission then publishes; all mediated listings visible in main admin dashboard; (i) chat contact-detection extended to **social-media IDs** in addition to phone/email. | Mehdi | §13 (new), §2.2, §6.4, §6.5, §9 |

---

## 1. Product Overview

**Working name:** `propverify` (rename later — keep the codebase name-agnostic via config)

**Concept:** A trust-first real estate super app for Northern Cyprus (TRNC). Every property,
agent, agency, and developer is document-verified by admins before going live. The platform
covers the ENTIRE journey: discovery → viewing → offer → contract → deal completion →
post-deal services. Web app first (SEO-critical), mobile apps in Phase 2 sharing the same API.

**Core promise:** "If it's on the platform, it's real, it's available, and the seller is who they say they are."

**Why it wins:** Competitors (Bayut-style portals, Facebook groups, agency sites) compete on
listing volume. We compete on verification + a complete transaction pipeline + the only real
deal-record database in TRNC.

**Launch users:** Developer, Real Estate Agency, Solo Agent, Owner (resale + rental),
Customer (buyer + renter), Admin.

**Future lateral users (MUST be addable without refactor):** Lawyer, Furniture Company,
Rental/Moving Company, Insurance, Property Management, Notary/Translation. See §2.2.

**Locale requirements:**
- Languages: English (default), Turkish, Russian, Farsi. i18n from day one (`next-intl` or equivalent). RTL support required for Farsi.
- Currencies: GBP (primary quote currency in TRNC market), EUR, USD, TRY. Store prices in a base currency (GBP) + display conversion via daily-cached FX rates.
- Regions taxonomy: Kyrenia (Girne), Famagusta (Gazimağusa), İskele, Nicosia (Lefkoşa), Güzelyurt, Lefke — with district/neighborhood sub-levels.

---

## 2. Architecture Rules (NON-NEGOTIABLE)

### 2.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Web frontend | Next.js 14+ (App Router, TypeScript) | SSR/ISR for SEO on listing + insight pages |
| Mobile (Phase 2) | React Native (Expo) | Consumes same REST API; share types via a `packages/shared` workspace |
| Backend | NestJS (TypeScript) | Modular monolith. NOT microservices. Module boundaries listed in §2.3 |
| Database | PostgreSQL 15+ | Prisma ORM. All schemas in §5 |
| Search | Meilisearch | Listings index; sync via outbox pattern |
| Cache/queues | Redis + BullMQ | Sessions, rate limits, notification jobs, verification queue events |
| File storage | S3-compatible (start: Cloudflare R2) | Documents bucket = PRIVATE, signed URLs only. Media bucket = public CDN |
| Realtime | WebSockets (Socket.io via NestJS gateway) | Chat, notifications, verification status updates |
| Auth | Phone OTP + email/password, JWT (access 15min / refresh 30d rotating) | KYC layer for professional roles |
| Repo layout | Turborepo monorepo: `apps/web`, `apps/api`, `apps/mobile` (Phase 2), `packages/shared`, `packages/ui` | |
| Infra | Docker Compose for dev; deploy to Hetzner/AWS + Cloudflare. GitHub Actions CI (lint, typecheck, test, build) | |

### 2.2 Plug-in Role System (this is how lateral users get added later)

**Rule:** Roles are DATA, not code branches. Never write `if (user.role === 'lawyer')` scattered through the app.

- `roles` table + `permissions` table + `role_permissions` join. Seed the 6 launch roles.
- A user can hold MULTIPLE role assignments (`user_roles`), each with its own verification status
  (e.g., an Owner who is also a Customer).
  *(Change 2026-07-10: the account type is selected at registration; users cannot self-add roles
  from the dashboard. Additional role grants are an admin action.)*
- Every role has a **Profile Extension** — a dedicated table (e.g., `agent_profiles`, `developer_profiles`)
  joined 1:1 to the user. Adding a Lawyer later = new row in `roles`, new `lawyer_profiles` table,
  new permission rows, new dashboard module. Zero changes to core.
- **Service Provider abstraction (build the interface now, even though empty at launch):**
  a `service_providers` table (`user_id`, `service_type`, `verification_status`, `pricing_model`, `regions_served`, `metadata jsonb`).
  Lateral roles (lawyer, furniture, movers) are Service Providers that get **injected into deal
  pipeline stages** (§7). The deal pipeline stage config declares which `service_type`s can attach
  at which stage. This makes the "super app" expansion a config + one-module job.
- **Dashboard shell:** one authenticated layout that renders navigation/widgets from a per-role
  module registry (a typed config object mapping role → menu items → route modules). New role = register a module.
- **Verification requirements per role are config:** a `verification_requirements` table
  (`role_id`, `document_type`, `is_required`, `description`) drives both the upload UI and the admin
  checklist. Adding a lawyer's "bar license" requirement later = one seed row.

### 2.3 Backend module boundaries (NestJS modules)

`auth`, `users`, `roles`, `verification`, `properties`, `projects` (developer inventory), `media`,
`documents`, `search`, `chat`, `deals`, `offers`, `viewings`, `ratings`, `notifications`,
`payments` (stub until Phase 3), `service-providers` (stub interface at launch), `admin`, `analytics`, `audit`.

Each module: controller + service + repository, own DTOs, emits domain events on a local event bus
(NestJS `EventEmitter2`). Cross-module reads go through service interfaces, never direct table access
from another module's repository.

### 2.4 Cross-cutting requirements

- **Audit log:** every mutation on users, documents, verifications, listings, deals writes to `audit_logs`
  (actor, action, entity, before/after jsonb, ip, timestamp). Append-only.
- **Soft deletes** everywhere (`deleted_at`). Hard delete only via admin data-retention job.
- **All documents encrypted at rest** (R2/S3 SSE) and served ONLY via short-lived signed URLs gated by permission checks.
- **Rate limiting** on auth, chat, and inquiry endpoints (Redis).
- **Anti-bypass:** phone numbers/emails masked in listings and chat until a viewing is booked or offer made
  (regex scrubbing in chat messages with a "contact revealed at viewing stage" notice).
- **Every listing photo:** EXIF stripped on upload, perceptual hash stored (`phash`) for duplicate detection across listings.

---

## 3. Roles & Permission Matrix

| Capability | Customer | Owner | Solo Agent | Agency | Developer | Admin |
|---|---|---|---|---|---|---|
| Browse/search verified listings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Save searches, favorites, alerts | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Create resale/rental listing | — | ✅ | ✅ (with owner mandate doc) | ✅ (via its agents) | — | — |
| Create project + unit inventory | — | — | — | — | ✅ | — |
| Delegate listing to agent | — | ✅ | — | — | — | — |
| Manage sub-agents | — | — | — | ✅ | — | — |
| Book viewings / send offers | ✅ | — | on behalf of buyer | on behalf | — | — |
| Accept/reject offers | — | ✅ | if mandated | if mandated | ✅ | — |
| In-app chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (support) |
| Deal room participation | party-based (any user who is a party to the deal) | ← | ← | ← | ← | ✅ oversight |
| Rate counterparty post-deal | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Verification queue, approve/reject | — | — | — | — | — | ✅ |
| Dispute center, user management, analytics | — | — | — | — | — | ✅ |

**Admin sub-roles (seed now):** `super_admin`, `verification_officer`, `support_agent`, `content_moderator`.

**Verification requirements (seed data for `verification_requirements`):**

- **Owner listing (resale):** title deed (koçan) with type tag [Turkish / Exchange-Eşdeğer / Allocation-Tahsis / Foreign], owner ID/passport, name-match confirmation, recent utility bill or council tax doc, photos (min 5).
- **Owner listing (rental):** title deed OR rental authority doc, owner ID, photos (min 5).
- **Solo Agent:** government ID, real-estate license/authorization, selfie-with-ID (liveness lite), phone verified. Per-listing: signed owner mandate PDF.
- **Agency:** business registration, tax number, license, office address proof, authorized signatory ID.
- **Developer:** company registration, tax number, portfolio, per-project construction permit + project plans.
- **Customer:** phone OTP only (email optional). No docs to browse; ID required only when entering a deal room.

**Badge tiers:** `unverified` → `pending` → `verified` → `trusted_partner` (auto-granted: ≥5 completed deals AND avg rating ≥4.5 AND 0 upheld disputes in 12 months — computed nightly job).

---

## 4. Verification Engine (build in Phase 1, it's the moat)

### Listing verification flow
1. Owner/agent completes the **Listing Wizard** (multi-step: details → location map-pin → features → photos → document upload boxes driven by `verification_requirements` → review → submit).
2. Listing saved as `status = pending_verification`. Not in public search index.
3. Job pushes item into admin **Verification Queue** (BullMQ), assigned FIFO or by claimed-by-officer.
4. Admin dashboard shows: side-by-side document viewer (signed URLs, watermark "VERIFICATION COPY" overlay in viewer), checklist per requirement, deed-type selector, name-match check, duplicate-photo flags (phash), price-anomaly flag (±40% from region median price/m²).
5. Per-document decision: `approved` / `rejected(reason_code, note)`. Reason codes enum: `illegible`, `expired`, `name_mismatch`, `wrong_type`, `suspected_forgery`, `other`.
6. All approved → listing `status = live`, indexed in Meilisearch, "Verified" badge + deed type shown publicly. Any rejected → owner notified with reasons, re-upload only rejected boxes.
7. **Freshness rule:** every 90 days owner must one-tap confirm availability (push + WhatsApp + email nudges at day 83/88/90). No confirmation → auto `status = paused` (hidden). Price edit resets nothing; document change resets to `pending_verification` for the changed doc only.

### Profile verification flow
Same queue, `entity_type = 'profile'`. Professional roles cannot list/receive leads until `verified`.

### Admin verification dashboard requirements
- Queue table: filters (entity type, region, age, officer), SLA timer per item (target 24h), bulk claim.
- Detail view: document panels, decision buttons, internal notes thread, full history.
- Fraud tools: same-document-hash used across accounts alert, same-phone/IP multi-account alert.
- Metrics: queue depth, avg turnaround, approval rate, rejections by reason.

---

## 5. Database Schema (Prisma — core tables, abbreviated field lists)

```
users(id, phone, phone_verified_at, email, password_hash, locale, avatar_url, status[active/suspended/banned], created_at, deleted_at)
roles(id, key, name)                             -- seed: customer, owner, solo_agent, agency, developer, admin
permissions(id, key)                             -- e.g. listing.create, verification.review
role_permissions(role_id, permission_id)
user_roles(id, user_id, role_id, verification_status, badge_tier, created_at)

admin_profiles(user_id, sub_role)
agent_profiles(user_id, license_no, bio, regions[], response_time_avg_sec, deal_count, rating_avg)
agency_profiles(user_id, company_name, reg_no, tax_no, address, logo_url, ...)
agency_agents(agency_id, agent_user_id, status, joined_at)                  -- team management
developer_profiles(user_id, company_name, reg_no, portfolio_json, ...)
owner_profiles(user_id, ...)         -- thin at launch
service_providers(id, user_id, service_type, verification_status, pricing_model, regions[], metadata jsonb)  -- lateral roles, empty at launch

verification_requirements(id, role_id NULL, context[profile/listing_resale/listing_rental/project], document_type, is_required, title_i18n, help_i18n)
verification_items(id, entity_type[profile/listing/project/document], entity_id, status, claimed_by_admin_id, sla_due_at, decided_at)
documents(id, owner_user_id, entity_type, entity_id, document_type, storage_key, mime, size, sha256, status[pending/approved/rejected], reject_reason_code, reject_note, uploaded_at)

properties(id, kind[resale/rental], created_by_user_id, on_behalf_of_owner_id NULL, mandate_document_id NULL,
  title_i18n, description_i18n, region_id, district, lat, lng, price_amount, price_currency, price_base_gbp,
  bedrooms, bathrooms, area_m2, plot_m2, deed_type[turkish/exchange/allocation/foreign/na], furnished, features jsonb,
  status[draft/pending_verification/live/paused/under_offer/sold/rented/archived],
  availability_confirmed_at, view_count, save_count, created_at, deleted_at)
property_media(id, property_id, type[photo/video/tour360], url, phash, sort_order)

projects(id, developer_user_id, name_i18n, region_id, lat, lng, description_i18n, delivery_date, payment_plans jsonb, status)
project_media(...) 
project_units(id, project_id, unit_no, type, bedrooms, area_m2, floor, price_amount, price_currency, status[available/reserved/sold], plan_media_id)
project_updates(id, project_id, title_i18n, body_i18n, media jsonb, published_at)   -- construction progress feed

saved_searches(id, user_id, query jsonb, alert_channel[push/email/whatsapp], last_alert_at)
favorites(user_id, property_id, created_at)

conversations(id, property_id NULL, deal_id NULL, created_at)
conversation_participants(conversation_id, user_id, role_in_convo)
messages(id, conversation_id, sender_id, body, body_scrubbed boolean, attachments jsonb, read_at, created_at)

viewings(id, property_id, customer_id, host_user_id, scheduled_at, status[requested/confirmed/completed/cancelled/no_show], notes)
offers(id, property_id, customer_id, amount, currency, terms_note, status[submitted/countered/accepted/rejected/withdrawn], parent_offer_id NULL, created_at)

deals(id, property_id NULL, project_unit_id NULL, kind[purchase/rental], status, current_stage_key, created_at, completed_at)
deal_parties(deal_id, user_id, party_role[buyer/seller/agent_buyer_side/agent_seller_side/lawyer/service_provider], joined_at)
deal_stages(id, deal_id, stage_key, status[pending/active/completed/skipped], completed_at, completed_by)
deal_documents(deal_id, document_id, stage_key)
deal_snapshot(deal_id, property_snapshot jsonb, price_agreed, currency, commission_split jsonb)   -- frozen at acceptance
deal_events(id, deal_id, actor_id, event_type, payload jsonb, created_at)                          -- immutable timeline

pipeline_templates(id, kind[purchase/rental], stages jsonb)   -- config-driven stages, see §7; service_type injection points declared here

ratings(id, deal_id, rater_id, ratee_id, stars, tags[], comment, created_at)
disputes(id, deal_id, opened_by, against_user_id, reason, status, resolution_note, resolved_by_admin_id)

notifications(id, user_id, channel, template_key, payload jsonb, sent_at, read_at)
audit_logs(id, actor_id, action, entity_type, entity_id, before jsonb, after jsonb, ip, created_at)
fx_rates(base, quote, rate, fetched_at)
regions(id, parent_id, name_i18n, slug, lat, lng)
```

Indexes: geo (lat/lng gist or PostGIS), `properties(status, region_id, price_base_gbp)`, `documents(sha256)`, full sync of `live` properties into Meilisearch with fields: region, price_base_gbp, bedrooms, deed_type, kind, features, geo.

---

## 6. Feature Specifications

### 6.1 Search & discovery (Customer)
- Map-first UI: cluster pins, polygon draw filter, list/map toggle, POI layers (universities, beaches, hospitals — static GeoJSON seed).
- Filters: kind, region/district, price range (in user currency, converted), beds/baths, area, deed type, furnished, features, project vs resale, "new this week".
- Sort: relevance, newest, price, price/m². Verified badge and deed type shown on every card.
- Saved searches with alerts (push/email/WhatsApp-ready template), price-drop notifications on favorites.
- Compare view (up to 4 properties side by side).
- Calculators: mortgage/installment (developer payment plans rendered as schedule tables).
- SEO: SSR listing pages, schema.org RealEstateListing markup, region landing pages, monthly market-insights pages (Phase 3 data, static placeholders Phase 1).

### 6.2 Listing management (Owner/Agent/Agency)
- Wizard per §4. Draft autosave. Photo uploader with reorder, cover select, min-5 enforcement, phash dedupe warning.
- "Delegate to agent" flow: owner searches verified agents → sends mandate request → agent accepts → mandate PDF generated → both e-sign (simple typed-signature + audit trail at launch) → agent gains listing management permission.
- Status board: draft / pending / live / paused / under offer / sold-rented. One-tap 90-day availability confirm.
- Lead inbox: inquiries, viewings, offers per listing, response-time tracking.

### 6.3 Developer module
- Project creation: master info, media, payment plans (structured: down %, installments, delivery-linked), unit inventory (bulk CSV import + inline editor), live availability grid.
- Construction progress updates feed; buyers of units auto-follow.
- Leads + reservation requests per unit. Reservation = deal with `kind=purchase` starting at reservation stage.

### 6.4 Chat
- Per-property conversation threads; participants added by context (customer↔lister; deal room adds parties).
- Contact-info scrubbing until viewing confirmed (regex phone/email → replaced with notice; log attempts).
- Attachments (images/PDF), read receipts, typing indicator. Auto-translate button (stub interface; wire to translation API later).

### 6.5 Ratings & reputation
- Only unlocked after `deal.completed` for the parties. Stars + tag chips (responsive, honest, smooth process...) + optional comment. Both-submit-or-14-days reveal rule (prevents retaliation).
- Feeds agent ranking score = f(rating_avg, deal_count, response_time, dispute_rate) — computed nightly, used as search-ranking boost for agent listings and agent directory.

### 6.6 Notifications
- Channels: in-app (WebSocket), push (FCM via Expo Phase 2), email (Resend/SES), WhatsApp (template messages via Meta Cloud API — architecture ready Phase 1, enable Phase 2).
- Template registry keyed (`verification.approved`, `offer.received`, `deal.stage_advanced`, `availability.confirm_needed`, ...). All i18n.

### 6.7 Admin suite
- Verification queue (§4), user management (suspend/ban with reason, role grants), listing moderation, dispute center (evidence = deal_events + documents + chat export), analytics dashboard (supply/demand by region, funnel: view→inquiry→viewing→offer→deal, verification SLA), audit log browser, CMS-lite for region landing content.

---

## 7. Deal Pipeline (config-driven — the super-app backbone)

Stages live in `pipeline_templates.stages` as ordered JSON; each stage declares: `key`, `title_i18n`,
`required_documents[]`, `completes_by` (which party role), `injectable_service_types[]` (for lateral providers), `notifications[]`.

**Purchase template (seed):**
`inquiry → viewing → offer → offer_accepted [creates deal + snapshot] → legal_check (injectable: lawyer) → contract_signing → deposit_recorded → permit_process (foreign buyers; skippable) → completion/handover → post_deal (injectable: furniture, movers, insurance)`

**Rental template (seed):**
`inquiry → viewing → application (renter ID, optional income proof) → landlord_approval → contract (template PDF generated, both e-sign) → deposit_recorded → move_in_checklist (photo checklist both parties confirm) → active_tenancy → renewal_reminder/exit_checklist`

- Customer sees a **visual journey tracker** (stepper UI) with "what happens next" copy per stage.
- Deposits at launch = RECORDED, not processed (upload receipt/reference). Real escrow = Phase 3 with licensed partner; build `payments` module as stub interface now.
- On `offer_accepted`: freeze `deal_snapshot`, lock listing to `under_offer`.
- On completion: listing → sold/rented, ratings unlock, deal record archived immutably, commission split recorded.

---

## 8. Growth & Algorithm Features

- **Recommendation engine v1 (Phase 2):** co-visitation ("viewers of X also viewed") from a `property_view_events` table; nightly batch job. v2: collaborative filtering.
- **Price intelligence:** nightly region median price/m² by (region, kind, bedrooms); flag listings ±40% (admin signal + "priced above/below market" internal metric). Phase 3: public market insights pages + valuation estimate.
- **Ranking:** verified > freshness > completeness score (photos, docs, description length) > lister reputation. Never let paid boosts override verification requirement.
- **Referrals:** unique invite codes per user; agents inviting owners who publish a verified listing earn a featured-listing credit. Track in `referrals` table.
- **Retention loops:** saved-search alerts, price drops, construction updates for followed projects, 90-day confirmations.

---

## 9. Monetization hooks (build the seams, enable later)

`plans` + `subscriptions` tables (agent/agency/developer tiers: listing caps, lead priority, analytics, branding), `featured_slots` (region + date-ranged paid placements), media-services order form (photography/360 — manual fulfillment), success-fee fields on `deal_snapshot.commission_split`. Payments processing itself is Phase 3.

---

## 10. Build Phases & Task Breakdown

### Phase 1 — MVP (target ~14 weeks of work)
1. **Foundation (wk 1–2):** Turborepo scaffold, Docker Compose (postgres, redis, meilisearch, minio for local S3), Prisma schema (§5), seed script (roles, permissions, verification_requirements, regions, pipeline_templates, admin user), auth module (OTP mock in dev, Twilio-ready interface), audit middleware, CI.
2. **Roles & profiles (wk 2–3):** registration flows per role, profile extensions, role module registry + dashboard shell, i18n setup (EN/TR first, RU/FA keys stubbed).
3. **Listings (wk 3–6):** wizard, media upload pipeline (EXIF strip, phash, thumbnails), document upload boxes from config, Meilisearch sync, map search UI, filters, listing detail page (SSR + schema.org), favorites, saved searches.
4. **Verification engine (wk 5–8):** queue, admin dashboard, document viewer with signed URLs, decision flows, notifications, freshness job.
5. **Chat + viewings + offers (wk 8–11):** conversations, scrubbing, viewing scheduler, offer/counteroffer flow.
6. **Deals v1 (wk 10–13):** pipeline engine from templates, deal rooms, journey tracker UI, deal snapshot, deal events, manual deposit recording, completion + ratings.
7. **Hardening (wk 13–14):** rate limits, e2e tests (Playwright) on the 5 critical flows (register+verify profile, publish+verify listing, search→viewing, offer→deal completion, admin queue), load test search, security pass (signed URLs, RBAC on every endpoint), seed 50 demo listings.

**Phase 1 exit criteria:** an owner can publish a document-verified listing; a customer can find it, chat, book a viewing, make an offer, and complete a tracked deal; admin can verify everything and see the audit trail. All in EN + TR.

### Phase 2 (~months 4–8)
Expo mobile apps (customer + agent focus), push notifications, WhatsApp channel live, developer project module full build (inventory grid, progress feed, reservations), ratings→ranking, recommendation v1, RU/FA locales, agency team management, rental contract PDF generation + typed e-sign, analytics dashboards for pro roles, referral system.

### Phase 3 (~months 8–14)
Service-provider marketplace activation (Lawyer first: directory, attach-to-deal at `legal_check`, quote/accept flow — reuses `service_providers` + pipeline injection built in Phase 1), payments module (subscriptions + featured slots via Stripe or regional PSP; escrow deposits via licensed partner — legal review required), market insights pages + valuation estimate v1, dispute center full workflow, data export/reporting for admins, translation API in chat.

---

## 11. Non-functional requirements

- p95 search API < 300ms; listing page LCP < 2.5s on 4G.
- All endpoints behind RBAC guards generated from the permission table; deny by default.
- GDPR-style data handling: user data export + deletion request flow (admin-processed), document retention policy config.
- Backups: nightly Postgres dump + object-storage versioning; restore runbook in `/docs`.
- Error tracking (Sentry), structured logging (pino), health checks, uptime monitoring.
- Test coverage: unit on services ≥70%, e2e on the 5 critical flows, verification engine at 90%+.

## 12. Deliverables checklist for Claude Code

- [ ] Monorepo scaffold with all §2.1 services running via `docker compose up`
- [ ] Prisma schema + migrations + full seed (roles, permissions, requirements, regions, templates, admin)
- [ ] Auth (OTP + JWT rotation) with RBAC guard system
- [ ] Role-module dashboard shell (config-registered modules)
- [ ] Listing wizard + media/document pipeline + Meilisearch-powered map search
- [ ] Verification engine + admin dashboard (queue, viewer, decisions, freshness job)
- [ ] Chat with contact scrubbing; viewings; offers
- [ ] Config-driven deal pipeline + deal rooms + journey tracker + snapshots + ratings
- [ ] Notifications (in-app + email live; push/WhatsApp interfaces stubbed)
- [ ] Audit logs on all sensitive mutations
- [ ] i18n EN/TR complete; RU/FA scaffolded; multi-currency display
- [ ] `service_providers` + pipeline injection points implemented (empty but functional)
- [ ] Tests + CI green; README with setup, architecture map, and how-to-add-a-new-role guide

> **How to add a lateral role later (must be documented in README):**
> 1) seed `roles` + permissions, 2) create `<role>_profiles` table + migration, 3) seed `verification_requirements`,
> 4) register dashboard module, 5) if service provider: add `service_type` + declare injection stages in pipeline template. No core changes.

---

## 13. Marketplace Mechanics Expansion (added 2026-07-12, requested by Mehdi)

### 13.1 Organization accounts (Developer & Agency)
- Developer and Agency accounts are **organizations**: one **org admin** user plus member users.
- Org admin capabilities: create / edit / deactivate-remove member accounts, manage org profile,
  see org-wide analytics. Members: maintain portfolio/listings/leads within the org.
- Data model: reuse `agency_agents` pattern; add `developer_members`. Member accounts are normal
  users linked to the org with an org-role (`org_admin` / `member`) — permissions stay data-driven (§2.2).
- **Government legality verification:** org uploads registration documents in its profile section;
  admin approval ⇒ **verified tick** shown publicly on the org account (existing verification engine, §4).

### 13.2 Public performance & reputation
- Each agency member's activity is **publicly visible**: number of rentals closed, number of sales
  closed; agency page shows per-member stats + org totals. Same principle for solo agents.
- **Profile reviews (decision 2026-07-12: interaction-gated):** only users who actually
  interacted with the professional (completed deal, viewing, or accepted assignment) can review.
  Profile owners can NEVER delete reviews. They can **report** a review → admin moderation queue →
  admin may remove the message; repeat offenders get warnings; after 2–3 warnings (configurable)
  the user is **banned** — and because identities are verified, the ban is durable (same ID/phone
  cannot re-register).
- **Star / reward tiers (future update):** from accumulated performance data, solo agents,
  agencies and their members earn stars; each star level unlocks defined rewards. Rules TBD —
  build the data collection now (deal counts, ratings, response times already tracked).

### 13.3 Subscriptions (details TBD — build the seams)
- **Listing uploads require an active subscription** (rent and resale).
- Tiered plans, different per user type (customer/owner/agent/agency/developer).
- Higher tiers ⇒ access to more **premium properties** and greater accessibility/visibility.
- Exact tiers, pricing and premium-property definition TBD; `plans` + `subscriptions` tables (§9)
  carry this. **Decision 2026-07-12:** until payments (Phase 3), subscription checks are enforced
  in code and admins grant/revoke subscriptions manually from the main dashboard — payment
  collection plugs in later without rework.

### 13.4 Find-my-agent — private resale flow
- Rentals: verified rental listings go straight to the public rent section (unchanged).
- **Resale:** after the owner enters all information and passes verification, the listing is
  **NOT publicly visible**. The owner opens **"Find my agent"** and selects N verified agents
  (N configurable in the main admin dashboard, default 2–3) for a fixed **term of 1–6 months**.
- Selected agents see the request in their dashboard and **accept or reject**. The file stays
  private — never broadcast to everyone.
- The accepting agent works the property; when ready, the agent **adds their commission and
  publishes** it.
- After the term expires, the owner can **reassign** to different agents.
- **Decisions 2026-07-12:** (1) agent-mediated resale is **mandatory for now**; a main-admin
  dashboard toggle may later allow owner-direct resale publishing. (2) The assigned agent
  **never sees the owner's contact details** — all owner↔agent communication is platform-mediated;
  at the physical deal stage a **platform-side agent attends in person** to assist and protect the deal.

### 13.5 Platform profit configuration
- Main admin dashboard has a **fully customizable profit-band table** keyed by price range, e.g.:
  `£50,000–£100,000 ⇒ £2,000 platform profit; £100,000–£200,000 ⇒ £4,000; …`
- Agent adds their own commission on top and publishes.
- All mediated listings appear in a **main-admin dashboard section** (property, owner, agent,
  platform profit, agent commission); each agent sees their own listings with the commission they added.
- **Decision 2026-07-12: buyer-pays model.** Published price = owner asking price + platform
  profit band + agent commission. The owner receives their full asking price. Competing agents
  on the same property keep commissions market-honest.

### 13.6 Chat anti-bypass (extends §2.4/§6.4)
- Built-in chat detection expands beyond phone/email to **social media IDs/handles**
  (Instagram/Telegram/WhatsApp mentions, @handles, t.me/wa.me links, obfuscated digits) —
  masked until the allowed stage, attempts logged for admin review.
