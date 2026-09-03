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
| 5 | Chat + viewings + offers (scrubbing incl. social-media handles per §13.6) | ✅ **Done** (offers switched off 2026-08-10 — see Change Log) | 2026-07-12 | Per-property inquiry threads (mediated listings route to the publishing agent, never the owner); scrub service masks phones/emails/@handles/t.me/wa.me/social mentions with every attempt audited; contact reveals only after confirmed viewing or accepted offer; owner↔agent channel ALWAYS scrubbed (🔒); viewing scheduler with host/customer state machine; offer → counter → accept flow locking listing to under_offer + de-indexing; in-app notifications for all events; messages/viewings/offers pages + action box on listing detail. Realtime is 4s polling for now — Socket.io upgrade in hardening. 11-check e2e green |
| 6 | Deals v1: pipeline engine, deal rooms, journey tracker, snapshots, ratings | ✅ **Done** | 2026-07-16 | On offer-accept, deal built from `pipeline_templates` (§7): frozen DealSnapshot (agreed price + ask/fee/commission split), parties (buyer/seller/seller-side agent), stages (pre-acceptance auto-completed, next active), deal-room conversation, immutable DealEvent timeline. Stage engine enforces `completesBy` + required-doc attachment; skippable stages (permit_process); completion → property sold/rented. Ratings post-completion with §6.5 both-submit-or-14-days reveal (nightly cron) feeding agent reputation; interaction-gated public reviews (§13.2). Web: deals list + deal room with visual journey tracker, per-stage doc upload, advance/skip, star+tags rating form. 16-check e2e green (accept→snapshot→advance→doc-gated stage→skip→complete→sold→reciprocal reveal→reviews→timeline) |
| 7 | Hardening: rate limits, e2e tests, load test, security pass, 50 demo listings | ✅ **Done** | 2026-07-24 | **Done:** 50-listing demo seed (`npm run db:demo`) across all regions/kinds/deed-types/price bands with photos + Meilisearch reindex; admin `POST /search/reindex`; security/RBAC audit of all 87 routes ([docs/security-audit.md](docs/security-audit.md)) — fixed 2 public-payload leaks (property internal IDs breaking §13.4 anonymity; review `raterId`), verified deny-by-default coverage + rate limits; observability — pino structured logging w/ request-ids + secret redaction, global exception filter (consistent error shape, no stack leak), `/health/ready` readiness probe (DB + Meilisearch + storage), graceful shutdown hooks; **Socket.io realtime chat** — JWT-authed gateway, participant-checked conversation rooms, live message + inbox-notify delivery (4s polling replaced by a 30s reconnection-only fallback), decoupled via domain events; **BullMQ** — the 3 daily jobs (freshness sweep, assignment expiry, rating reveal) moved off @nestjs/schedule onto a Redis-backed `maintenance` queue with repeatable schedulers + a single worker, so each runs exactly once across instances (admin endpoints still trigger on demand); **e2e suite** — committed self-contained integration test ([apps/api/test/e2e/critical-flows.mjs](apps/api/test/e2e/critical-flows.mjs), `npm run test:e2e`, 16 checks) covering all 5 critical flows woven into one scenario (register+verify agent → publish+verify listing via find-my-agent → search→viewing → offer→deal completion+ratings → admin queue), plus a CI `e2e` job that stands up the full stack via docker compose, migrates+seeds, boots the API and runs it; **load test** — `npm run test:load` ([docs/performance.md](docs/performance.md)) hits public search with randomised filters, baseline **p95 268 ms / 239 req/s / 0 errors** clears the §11 <300 ms NFR; found + fixed a throttle misfire (global 120/min was capping public browse — search + property detail are now `@SkipThrottle`-exempt, tight limits kept on auth/chat/inquiry). **Deferred to deployment:** Sentry SDK wire-up (exception filter is the hook, `SENTRY_DSN` env ready) — everything else in §10.1 step 7 complete. **Phase 1 MVP complete.** |

### Build status (Phase 2, §10.2)

| # | Step | Status | Date | Notes |
|---|---|---|---|---|
| 1 | Developer project module: inventory grid, progress feed, reservations (§6.3) | ✅ **Done** | 2026-07-27 | Developer creates a project (subscription-gated per §13.3) with master info, photos, payment plans and per-project documents, then submits it to the **same verification engine** as listings (`entity_type = project`, signed-URL doc review, approve → `live`). **Unit inventory**: inline CRUD plus bulk **CSV import** that upserts by `unit_no` and reports bad rows instead of failing the batch; public availability grid rolls up total/available/reserved/sold + price-from/to + bedroom options, and never exposes who holds a unit (§13.4). **Discovery**: public project directory with region/bedroom filters, detail page, and a lead inquiry that opens a contact-scrubbed thread in the existing chat system (new `conversations.project_id`). **Reservations**: reserving a unit constructs an off-plan deal on the new `project_purchase` pipeline (reservation → legal_check → contract_signing → deposit → permit_process → construction → completion) with a frozen price snapshot; completing it marks the unit `sold`. **Progress feed**: developer posts construction updates that notify unit buyers, who auto-follow on reservation. Required a pipeline-template refactor — templates now resolve by **`key`** rather than `DealKind`, since a project-unit deal is still `kind=purchase` but runs the off-plan stage set. 37-check e2e green ([apps/api/test/e2e/project-flows.mjs](apps/api/test/e2e/project-flows.mjs), `npm run test:e2e:projects`); critical-flow suite re-run green against the template refactor. |
| 1b | Developer project module — web UI | ✅ **Done** | 2026-07-28 | Developer side: project board (`/dashboard/projects`, the nav entry that had been pointing at a missing route since step 2), single-page editor with region + map pin, delivery date, repeatable payment-plan rows, photo upload and config-driven document boxes, and a manage hub (`/dashboard/projects/[id]`) with Units / Updates / Leads tabs — inline unit CRUD, manual hold/release, paste-CSV bulk import surfacing the per-row skip reasons, a progress-update composer, and the inquiry + reservation inbox. Public side: SSR `/projects` directory with a no-JS GET filter form, and `/projects/[id]` with the availability grid (never showing who holds a unit), payment-plan cards, construction-progress timeline, Leaflet map, per-unit reserve and a contact-scrubbed inquiry box, plus schema.org `ApartmentComplex` JSON-LD. Full `projects` i18n namespace added across EN/TR/RU/FA (all four at 599-key parity). Verified against the live stack: board, editor, units hub and public pages drive correctly; holding a unit rolled the public grid to "5 of 6 available" and the JSON-LD to `numberOfAvailableAccommodationUnits: 5`. |
| 2 | Agency team management (§13.1 org accounts, §13.2 public performance) | ✅ **Done** | 2026-07-28 | New `agency_member` role (solo-agent permission set, seeded — roles stay data, never `if (role === …)`), and `agency_agents` — a table that existed since the init migration but had never been written to — gains an `org_role` so an agency can delegate team management. **Members**: the org admin adds them by phone; an unknown number gets an account created and the person signs in with the normal OTP, so no credential is ever shared. Members inherit the agency's verification instead of uploading their own documents, and **list under the agency's subscription** — implemented in `SubscriptionsService.hasActive` so listings, projects and any future gate inherit it rather than each growing its own special case. One agency per user is enforced. **Removal** deletes the `agency_member` role assignment rather than downgrading `verificationStatus`, because `PermissionsGuard` resolves permissions from role assignments alone and never reads verification status — a status downgrade would have left a removed member holding every listing permission. The membership row survives so completed deals keep their party history, and re-adding the same phone restores access. **Public** `/agencies/[id]`: verified tick, org totals and per-member closed-sales/rentals, with contact details and org roles deliberately excluded; SSR with `RealEstateAgent` JSON-LD. Dashboard `/dashboard/team` fills another nav entry that until now fell through to the Coming Soon catch-all. `team` i18n namespace added across EN/TR/RU/FA (all four at 627-key parity). 28-check e2e green ([apps/api/test/e2e/agency-team-flows.mjs](apps/api/test/e2e/agency-team-flows.mjs), `npm run test:e2e:team`), wired into CI, and driven through the real UI. Members are intentionally **not** individually selectable in the find-my-agent directory — the agency is; revisit if owners should be able to pick a named member. |
| 3 | Ratings → ranking (§6.5, §8) + analytics dashboards for pro roles (§6.7, §13.1) | ✅ **Done** | 2026-08-04 | **Ranking:** `agent_profiles` gains `ranking_score` / `dispute_rate` / `ranking_computed_at`, and the new `ReputationService` computes the §6.5 formula `f(rating_avg, deal_count, response_time, dispute_rate)` — each factor normalised 0–1 then weighted (weights + Bayesian prior live in `@propverify/shared` so the dashboard renders the same breakdown it scores on). Rating uses a Bayesian mean against a 3.5 prior, so one 5★ deal cannot outrank a long record; a fresh professional scores a neutral 53, not 0. **`response_time_avg_sec` is now actually computed** (it had a column since the init migration but nothing ever wrote it): the average gap between an inbound message and the pro's first reply, counting one reply per inbound burst. Recompute runs nightly on the BullMQ `maintenance` queue (02:00, after the 01:00 rating reveal), on every rating reveal, and on `deal.completed`; `POST /admin/jobs/reputation` triggers it on demand. The same pass finally implements the **§3 `trusted_partner` badge rule** (≥5 deals, ≥4.5★, 0 upheld disputes in 12 months) — reversible, and it never demotes a tier it did not grant. **Where the score lands:** the find-my-agent directory is ordered by it, and Meilisearch gets the full §8 ranking order — custom rules `freshnessTier > completenessScore > listerScore` appended to the defaults ("verified" needs no rule; only verified listings are indexed). Freshness is **bucketed into tiers** deliberately: a raw timestamp is unique per listing and would decide every comparison, leaving the two rules below it dead. A score change emits `reputation.updated`; search listens and re-syncs that lister's live listings, so the deals module never imports Meilisearch. **Analytics:** new `analytics` module with `GET /analytics/me` (role-aware by composition, not role branching — an agent-and-developer sees both blocks), `GET /analytics/projects/comparison` and admin `GET /analytics/admin/overview`. No endpoint takes a subject id: scope comes from the token, so the new `analytics.own.view` permission cannot be turned into a way to read a rival's numbers. New `property_view_events` table turns views into a time series (and is the shape the §8 co-visitation recommender needs). A lead is counted only where a participant has `roleInConvo = 'customer'` — the §13.4 owner↔agent mediation channel and deal rooms are property conversations too, and counting them inflated every funnel above it. §13.1b comparison reports mine-vs-market aggregates (median price/m², mean absorption) within each region and overall, and never identifies a competing project. **Web:** `/dashboard/analytics` (headline stats, conversion funnel, listing board, score breakdown showing points-of-weight per factor, agency member rollup, developer project cards + mine-vs-market table) and `/dashboard/admin/analytics` (verification SLA, 30-day market activity, supply by region). Also registered the **`agency_member` dashboard module**, which had been missing since Phase 2.2 — members held listing permissions but the shell gave them no listings nav. `analytics` i18n namespace added across EN/TR/RU/FA (all four at 685-key parity). 41-check e2e green ([apps/api/test/e2e/reputation-analytics-flows.mjs](apps/api/test/e2e/reputation-analytics-flows.mjs), `npm run test:e2e:reputation`), wired into CI, and driven through the real UI for the agent, developer and admin views. All three existing suites re-run green; each suite's `otp()` now backs off on the 429 rather than assuming a fresh rate-limit window, since a fourth suite makes back-to-back collisions likely. |

| 4 | Notification channels: push + email + WhatsApp alongside in-app (§6.6) | ✅ **Done** | 2026-08-04 | **Fan-out:** call sites still pass nothing but a template key — which channels a key uses is policy in `@propverify/shared` (`DEFAULT_CHANNELS` per category, category = the templateKey prefix), so "offers should also email" is a one-line change rather than a hunt through the modules that raise the event. Each delivery is its own `notifications` row, so a failed email is visible without hiding the in-app record that did work. The in-app row is written **synchronously** (the bell updates instantly, and it now also pushes over the existing Socket.io gateway); external channels are queued on a new BullMQ `notifications` queue with 4 attempts and exponential backoff, because an outbound call to Resend or Meta must never sit between a user accepting an offer and their response, and a provider outage must not roll back the domain action. The queue is fed by a `notification.queued` **event**, not an injected queue: `NotificationsModule` is `@Global` and imported by nearly everything, so depending on the jobs module from it would tangle the whole graph. **Providers:** email → Resend HTTP API, WhatsApp → Meta Cloud API, push → Expo (keyless, so it works the moment the mobile app ships). Each degrades to a **recorded `skipped`** with the reason when credentials are absent, rather than pretending it sent — dev and CI exercise the full fan-out with no secrets. Retryable is distinguished from terminal: a 4xx from a provider is our payload being wrong and is not retried. WhatsApp never sends free text — the Cloud API only accepts approved templates outside a 24h window, so a key with no `whatsappTemplate` is skipped instead of being downgraded to a message Meta would reject. **Copy:** server-rendered template catalogue in EN/TR/RU/FA with a separate title and body, since email needs a subject and push needs a short title — a sibling of the web's in-app strings, not a duplicate. **Preferences:** per-user, per-category, sparse (no row = platform defaults, so changing a default later reaches everyone who never expressed a preference); `in_app` is mandatory and re-added server-side even if omitted, because it is the record of what happened, not an opt-in. §4 freshness nudges reach push + WhatsApp + email purely from the `availability` defaults — no change to `FreshnessService`. **Also:** `push_tokens` (a device, not a session — Expo tokens that come back `DeviceNotRegistered` are pruned on the spot) with register/unregister endpoints ready for the Expo app, and a per-user delivery log answering "was I actually emailed?" without asking support. **Web:** `/dashboard/settings/notifications` — channel grid with `in_app` shown as a locked control rather than hidden, per-category reset to defaults, and the delivery log. `notificationSettings` i18n across EN/TR/RU/FA (all four at 721-key parity). 30-check e2e green ([apps/api/test/e2e/notification-channel-flows.mjs](apps/api/test/e2e/notification-channel-flows.mjs), `npm run test:e2e:notifications`), wired into CI, and driven through the real UI; all four existing suites re-run green. |

| 5 | Lead inbox (§6.2): inquiries, viewings, offers per listing + response-time tracking | ✅ **Done** | 2026-08-05 | Fills `/dashboard/leads`, the nav entry five roles have carried since Phase 1 step 2 that fell through to the Coming Soon catch-all. **A lead is one prospect on one listing, not one conversation** — the same person can message, book a viewing and then offer, and a lister needs that as a single actionable row, so conversations, viewings, offers and deals are folded together on `(propertyId, customerId)`. Derived `stage` tracks the furthest point reached (`new → in_conversation → viewing_booked → viewing_done → offer_made → won/lost`), with the summary counting the whole inbox even under a filter — a filtered view that also filtered the totals would hide the work left to do. **Response-time tracking** per §6.2: first-response seconds per lead (customer's first message → lister's first reply), an `awaitingReply` flag for leads opened and never answered, and an inbox average. **Anonymity is what the scoping is for:** leads derive from the listings the caller actually *fronts*, so on a mediated resale (§13.4) the publishing agent gets the lead and the owner sees nothing for that property; the owner↔agent channel is never a lead because it has no `customer` participant. Prospect identity is withheld until the §2.4 reveal gate, and that gate was **extracted from `ChatService.mustScrub` into a public `contactRevealed()`** rather than reimplemented — a second copy would eventually drift and leak a phone number. New `leads` module (a read model owning no tables; not in the original §2.3 list), gated on `listing.create` so no new permission was invented for a read-only view of data those roles already reach. **Web:** `/dashboard/leads` with summary tiles, stage + listing filters, per-lead viewing/offer chips, a 🔒 placeholder while contact is hidden, and links through to the thread and deal room. `leads` i18n across EN/TR/RU/FA (all four at 755-key parity). 29-check e2e green ([apps/api/test/e2e/lead-inbox-flows.mjs](apps/api/test/e2e/lead-inbox-flows.mjs), `npm run test:e2e:leads`), wired into CI, and driven through the real UI; all five existing suites re-run green. |

| 6 | Recommendation v1 (§8): co-visitation "viewers of X also viewed", nightly batch | ✅ **Done** | 2026-08-05 | **The input had to be fixed first.** `property_view_events` was recording every listing view as anonymous and *twice*: the SSR detail page fetches once for `generateMetadata` and once for the component, and the fetch runs on the Next server so it carried no viewer identity at all. Three fixes: the page fetch is wrapped in React `cache()` so one render is one fetch; a `pv_sid` httpOnly cookie set in middleware is forwarded as `x-session-key` (signed-out browsing is the bulk of a portal's traffic — without it co-visitation would only ever see signed-in users); and `JwtAuthGuard` now *optionally* reads a bearer token on `@Public()` routes, so a signed-in viewer is attributed and the **lister's own visits stop counting as demand** — that exclusion existed in the code but could never fire, because the public route never passed a viewer id. Dedupe is enforced by a **unique `dedupe_key`** (`propertyId:identity:30-min bucket`) rather than a read-then-write check: the view write is deliberately fire-and-forget so it adds no latency to a public page, which means two near-simultaneous requests would both pass a "seen recently?" test — Postgres rejecting the second insert is what actually makes one visit one view, and the counter only moves when a row was really created. **The recommender:** nightly BullMQ job (03:00) scans 90 days of view events, groups by signed-in viewer or session key, and scores pairs by **cosine over distinct viewers** (`co / √(|A|·|B|)`) rather than raw co-view counts — otherwise a popular listing gets recommended everywhere purely for being popular (asserted directly: the merely-popular listing scores 0.34 against the true pair's 0.78). Sessions touching 40+ listings are treated as crawlers and contribute no pairs; pairs under 2 co-views are coincidence and are dropped. The table is replaced wholesale in one transaction — a half-rebuilt table would serve a mix of today's and last week's rankings. `GET /search/similar/:id` is public and **falls back to comparables** (same kind/region/bedrooms, nearest price) when a listing has no view history, because a listing published this morning would otherwise show an empty strip forever. Only `live` listings are ever recommended — a sold one is a dead end. Lives under `/search` because the properties controller keeps `:id` last as a catch-all and a sibling route would shadow it. **Web:** "Viewers of this also viewed" / "Similar listings" strip on the listing detail page, in EN/TR/RU/FA. 24-check e2e green ([apps/api/test/e2e/recommendation-flows.mjs](apps/api/test/e2e/recommendation-flows.mjs), `npm run test:e2e:recommendations`), wired into CI, and verified end-to-end in the browser — a page reload added zero views, and the strip ranked the co-visited listing above the popular one. All six existing suites re-run green. v2 (collaborative filtering) replaces the scoring only; the table, job and endpoint stay. |

| 7 | Rental contract PDF generation + typed e-sign (§7 rental template, §6.2) | ✅ **Done** | 2026-08-09 | New `contracts` module renders a **Residential Tenancy Agreement** with `pdf-lib` from the frozen deal snapshot — property, rent, term, deposit and six clauses — then both principals sign it by typing their name. The PDF is an ordinary `documents` row, so it inherits the private bucket and 5-minute signed URLs (§2.4) instead of a second store; `documents/:id/url` now also admits **deal parties**, because a contract is owned by whoever pressed generate and the counterparty plainly has to read what they are signing. Signatories are the **principals only** (buyer/seller) — an agent on the deal can read the contract but does not sign a tenancy. Each signature records the typed name, timestamp and IP, and the PDF is **reprinted after every signature** so the document always matches the signature record (the storage key is overwritten rather than versioned: a tenancy has one contract, and the history lives queryably in `contract_signatures`). **The gate is the point:** an unsigned contract blocks `advanceStage`, checked in `DealsService` by querying the table directly so deals keeps no dependency on contracts — contracts already depends on deals. Generation is idempotent and the existing-contract lookup runs *before* the stage guard, so asking again after the deal has moved on returns the contract rather than erroring. **Scope, stated plainly:** rentals only. Purchase and off-plan deals also have a `contract_signing` stage, but a sale agreement is a different document with different clauses — those deals continue to attach a lawyer-drafted PDF by hand, and §10.2 scopes this step to rental contracts. **Also English-only:** pdf-lib's built-in Helvetica is WinAnsi-encoded and cannot represent Turkish ı/ş/ğ, Cyrillic or Arabic, so names are transliterated where there is an obvious equivalent rather than crashing the render of a legal document; TR/RU/FA contracts need an embedded Unicode TTF (fontkit + a Noto face) and are a deliberate follow-up. **Web:** contract panel in the deal room — generate, open the PDF via signed URL, see who has signed and when, and a typed-name signature box that states exactly what it records; the stage's advance button is disabled while a signature is outstanding rather than letting the user press a button that always 400s. `contract` i18n across EN/TR/RU/FA (all four at 775-key parity), with an ICU plural so a one-month deposit no longer reads "1 months". 30-check e2e green ([apps/api/test/e2e/contract-esign-flows.mjs](apps/api/test/e2e/contract-esign-flows.mjs), `npm run test:e2e:contracts`), wired into CI, and driven through the real UI; all seven existing suites re-run green. |

| 8 | Referral system (§8): invite codes, qualifying event, featured-listing credits | ✅ **Done** | 2026-08-10 | Every account gets a unique invite code, **minted on first read rather than at signup** so existing accounts — and accounts an agency creates for a member — get one with no backfill. The alphabet excludes 0/O/1/I/L because these codes get read aloud and retyped. Attribution happens **only on account creation**: signing in later on the same link is not a referral, and a mistyped or unknown code never blocks a signup (`attachOnSignup` deliberately swallows its own errors). `refereeId` is unique, so a race between two codes resolves to whoever landed first. **The §8 qualifying event** is the invitee publishing a *verified* listing — a draft or a listing awaiting verification earns nothing, which is what makes the reward meaningful. It hangs off the `listing.live` event, so neither properties nor verification knows referrals exist, and a rewards failure can never break publishing a listing. Qualifying issues the referrer a **featured-listing credit** (§9 `featured_slots` seam, but earned rather than bought — payments stay Phase 3). Spending one sets `properties.featured_until` and re-indexes; search gets a `featured:desc` ranking rule **above** freshness. Placing it there is safe precisely because every document in the index is already live and verified: §8's "never let paid boosts override verification requirement" holds structurally, not by convention. Only a live listing can be featured, credits cannot be double-spent, and a nightly 04:00 sweep lapses unspent credits and expired windows, re-indexing to drop the boost. The referrer's view shows counts and statuses but **never who accepted** — that would leak a stranger's account existence. **Web:** `/dashboard/referrals` (code, copyable invite link, summary tiles, anonymous invite list, credit ledger), a Feature action on the listings board that surfaces the API's refusal inline, and `?ref=CODE` capture on the auth page. `referrals` i18n across EN/TR/RU/FA (all four at 802-key parity). 31-check e2e green ([apps/api/test/e2e/referral-flows.mjs](apps/api/test/e2e/referral-flows.mjs), `npm run test:e2e:referrals`), wired into CI, and driven through the real UI. **Phase 2 is now complete except the Expo mobile app.** |

| 9 | Admin console: user management + dispute centre (§6.7) | ✅ **Done** | 2026-08-11 | Fills the last two dashboard nav entries that fell through to the Coming Soon catch-all. **User console** — search by phone/email filtered by status and role; suspend, ban or reactivate with a **mandatory reason** that lands in the audit log. A ban also **deletes every refresh token**, because `status` is only checked when a session is created — without that a banned user keeps working until their access token happens to expire. §13.2's identity-backed ban is asserted end-to-end: a banned phone cannot sign back in. **Role grants** finally make the 2026-07-10 change-log decision real ("granting additional roles later is an admin action") — and a granted professional role still starts `unverified`, so an admin handing out a role cannot bypass the §4 document check. `admin` is not grantable from the console and the `customer` baseline is not revocable. **Dispute centre** — the `disputes` table has existed since the init migration with nothing ever writing to it, which meant the `disputeRate` term of the §6.5 ranking score was permanently zero; that loop is now closed, and an upheld dispute recomputes the respondent's reputation immediately rather than waiting for the nightly sweep. A party opens a case against another party on their deal (one open case per pair per deal); the admin gets the §6.7 **evidence bundle assembled by the platform** — immutable deal timeline, attached documents and the full chat export — so nobody has to ask either side for their version. Scrubbed messages are exported **as stored**: the mask is itself the evidence that a §2.4 contact-bypass was attempted. 44-check e2e green ([apps/api/test/e2e/admin-console-flows.mjs](apps/api/test/e2e/admin-console-flows.mjs), `npm run test:e2e:admin`), wired into CI. |

| 10 | Deployable production stack + UX clarity pass | ✅ **Done** | 2026-08-13 | **Deployment:** the repo had no Dockerfiles at all and `docker-compose.yml` only started dev infrastructure, so nothing could actually be deployed. Added `apps/api/Dockerfile` and `apps/web/Dockerfile` (multi-stage, Debian slim because Prisma's query engine and sharp ship glibc binaries; install and build share a stage because npm workspaces nests some dependencies under `apps/*/node_modules` and copying only the root one yields an image that boots then dies on a missing module), `docker-compose.prod.yml` (runs everything, publishes **no** database/cache/search ports, every credential from a gitignored `.env.production`), a `Caddyfile` (only public listener, automatic Let's Encrypt, listing photos proxied at `api.<domain>/media` so MinIO is never exposed and the documents bucket stays private) and [docs/deployment.md](docs/deployment.md). The API applies its own migrations on boot, so `up -d --build` is the whole deploy. Both images were **built and run-tested**, which caught two things a build alone would not: Prisma needed `binaryTargets` including `debian-openssl-3.0.x`, and a CRLF shebang would have made the entrypoint a "bad interpreter" crash on Linux (now pinned by `.gitattributes`). Final check: `{"status":"ready","deps":{"db":"up","meilisearch":"up","storage":"up"}}`. **Target host is a VPS** — Hostinger's shared/Cloud hosting and its Git "framework preset" screen host one built app and cannot run two Node servers plus Postgres, Redis, Meilisearch and object storage. **UX pass:** fixed a live defect where every notification and deal-timeline entry rendered as a raw key (next-intl reserves `.` for nesting, so flat keys like `"verification.approved"` were unreachable) and added the six event keys that had no copy at all; added `GET /users/me/next-steps` driving a role-aware "Getting started" checklist on the dashboard, with the rules server-side so web and API cannot drift — its `choose_agents` step finally explains why a *verified* resale is invisible (§13.4), which was the single biggest source of confusion; and listing status badges now carry a plain-language explainer. All four locales at 896-key parity. All three items left open here were closed in step 11. |
| 11 | UX clarity pass part 2: empty states, the trust promise, zero-result search | ✅ **Done** | 2026-08-21 | Closes the three items step 10 left open. **Empty states:** one shared [`EmptyState`](apps/web/src/components/EmptyState.tsx) replaces the dead-end one-liners on listings, leads, deals, viewings, offers (received *and* sent) and projects, plus mandates — each now carries a one-line explanation of what will fill it and a real control, not a sentence telling the user to go find one. The offers board is the interesting case: with `offers.enabled` off, the *sent* empty state deliberately drops its CTA, because sending someone to a listing to make an offer they cannot make is the same dead end in a nicer box — *received* keeps its action, which stays useful either way. Six now-unreachable `empty` keys were deleted rather than left to rot. **Trust promise:** the homepage explained the mechanics of verification but never the stakes, so a new *Why PropVerify exists* section states the problem (one home, five sites, three prices, months after it sold; deed type quietly changes what you are buying) and answers the three questions a buyer actually has — is the deed real, can this person sell, is it still on the market — each tied to something the engine really does (§4 + the seeded `verification_requirements`). A closing line keeps it honest: a documentary check is not legal advice or a guarantee of title. "How it works" was retuned to the buyer's journey so the two sections stop repeating each other. **Zero-result search:** `GET /search/listings` now returns a `suggestions` payload *only* when it finds nothing — which single criterion, dropped, would return results (and how many), which regions do hold this search (nearest first by real haversine distance from the one selected, via a Meilisearch `regionSlug` facet), and the unfiltered total behind "clear all filters". Every route offered is confirmed non-empty server-side before it is offered, so no button can land on another empty page; anything that would still return nothing is omitted. 23-check e2e suite ([search-suggestion-flows.mjs](apps/api/test/e2e/search-suggestion-flows.mjs), `test:e2e:search`, wired into CI) tags its own listings with a unique token so the counts hold regardless of demo data. All four locales at 940-key parity. **Found while verifying:** `offers.enabled` had been left `true` in the dev database by an earlier suite — restored to `false`, which is what `critical-flows` check 0a asserts. |
| 12 | Expo mobile app (§10.2 "customer + agent focus") — customer core + push | ✅ **Done** | 2026-08-21 | `apps/mobile` now exists: Expo SDK 52 / React Native 0.76 on expo-router, sharing `@propverify/shared` so role keys, locales and notification categories cannot drift from the API. **Scope chosen with Mehdi:** the customer core — auth (OTP + email, mirroring the web's single-flight refresh because the API treats a reused refresh token as theft), search with the §0 zero-result recovery, listing detail (verified badge, deed type, trust panel, enquire, request viewing, favourite), favourites + saved searches, viewings, chat, and a notifications tab. **The listing wizard is deliberately not here** — camera, document upload and a map pin belong on a desktop, and the account screen says so rather than leaving a seller hunting for the button. **Push is live:** `expo-notifications` registers against the `POST/DELETE /users/me/push-tokens` endpoints built in step 4, re-registering on sign-in and unregistering on sign-out — the token is per-account, so without that the next person to use the phone would inherit the last account's notifications. Registration is wrapped so a denied permission can never block a login. **Storage differs from web on purpose:** tokens go to the Keychain / Android Keystore via `expo-secure-store`, with a `localStorage` fallback that exists only for the browser preview. 18-check e2e suite ([push-device-flows.mjs](apps/api/test/e2e/push-device-flows.mjs), `test:e2e:push`, wired into CI) covers the device lifecycle the app depends on, including a handset changing hands between accounts. Own 139-key × 4-locale catalogue with a tiny local translator (next-intl has no RN runtime) that falls back through English rather than rendering a raw key. **Verified end-to-end through the browser preview** against the live API: sign in by OTP, favourite, enquire, request a viewing, and read the reply — including the §13.6 scrubber blanking a phone number and email in a sent message, and the Farsi switch. Two things a real device would need next: an EAS project id for production push tokens, and app icons/splash art. |
| 13 | §13.2 review moderation: report → admin queue → warnings → ban | ✅ **Done** | 2026-08-29 | The last big unbuilt spec item. **The shape follows from one rule:** profile owners can never delete a review, so the only lever an owner has is to report one and the only lever an admin has is to remove the *message*. `stars` and `tags` keep counting either way — otherwise a professional could launder their own score by reporting every bad write-up, which is the exact failure the verification premise exists to prevent, and the admin UI says so at the point of decision rather than in a policy page. New `review_reports` and `user_warnings` tables plus `ratings.comment_removed_at/_reason`; the original text is **kept, not overwritten**, so a removal stays reviewable afterwards, and the public payload still returns the row flagged `removed` rather than making it vanish (a review that silently disappears reads as censorship). **Escalation lands on the reviewer, not the review:** a removal can carry a warning, and `moderation.warnings_before_ban` (admin-configurable, default 3 per the §13.2 "2–3") warnings ban the account and delete its refresh tokens — `status` is only checked when a session is created, so without that a banned user keeps working until their access token expires. Ban is a side effect of counting, not a separate admin action, so the limit cannot be bypassed by forgetting to check. **Durability comes free from verified identity:** the row persists and `users.phone` is unique, so auth's existing "Account is not active" check blocks re-registration on the same number — asserted in the suite. New `moderation` notification category (in-app + push + email) with four templates in four locales; `review.report` granted to every reviewable role, `review.moderate` to admin. Web: an admin queue at `/dashboard/admin/reviews` showing the author's strike count and prior removals, and `/dashboard/reviews` where a professional reads their own reviews, reports one, and is told plainly that deleting is not on offer. 42-check e2e suite ([review-moderation-flows.mjs](apps/api/test/e2e/review-moderation-flows.mjs), `test:e2e:moderation`, wired into CI) builds two completed deals with **different star counts on purpose** — two 1-star reviews would have hidden a bug where removal dropped the row and moved the average. Verified through the live admin UI end to end: queue → decision → comment gone, stars and the 3.0 average unchanged, warning recorded against the author. **Deliberate limitation:** the `(rating, reporter)` unique constraint means an owner cannot re-report a review after a dismissal — it stops queue-flooding, at the cost of no route back if circumstances change. |
| 14 | §6.1 discovery alerts: price history, saved-search alerts, price-drop alerts | ✅ **Done** | 2026-09-02 | **Why this and not new ideas:** asked to take cues from the big portals, an audit of §6.1 found the spec already specifies most of what they do and much of it was never built despite step 3 being marked done — saved searches were stored but nothing read them, and favourites had no notion of price movement. **Price history:** new `property_price_changes` row per real movement on an already-priced listing (a draft being priced for the first time and a no-op re-save are both correctly *not* changes). Rows rather than a mutable `previousPrice` so a listing that drifts down keeps its whole trajectory. **Alerts:** two nightly BullMQ sweeps (07:00 / 07:15, after the 06:00 freshness pass so an alert never points at a listing about to be paused), plus `/admin/jobs/*` triggers for ops. Deliberately *pull* — "what is new since I last told this person" — rather than every publish fanning out to every saved search, so a user cannot be stormed. Cursors advance even on a silent run, or an empty window would be re-scanned forever. A price-drop is measured across the whole window, so two consecutive falls report their total and an up-then-down wobble is not a drop. New `discovery` notification category; threshold is the admin-configurable `alerts.price_drop_min_pct` (default 1%). **Two defects caught on the way:** the price-change rows carry the *owner's* ask, which on a mediated resale is not the public price — serving them raw would have leaked the agent's margin (§13.5), so the public now gets percentages only and the e2e asserts that boundary; and the web's notification renderer passed only `{title}` to next-intl, so any template needing `{count}` or `{pct}` would have thrown and rendered a raw key — the step-10 bug again. Fixed, and the **`moderation.*` copy from step 13 was missing from the web entirely** and would have rendered as raw keys too. **Badge:** `priceReducedPct` is indexed and shown on search cards, measured from the highest price ever asked so a nudge up-and-down cannot fake one. 24-check e2e suite ([discovery-alert-flows.mjs](apps/api/test/e2e/discovery-alert-flows.mjs), `test:e2e:alerts`, wired into CI). All four locales at 997-key parity. |
| 15 | §6.1 compare view + multi-currency display | ✅ **Done** | 2026-09-02 | **Currency:** `FxRate` was seeded in Phase 1 and never read by anything — every price on the site was GBP-only. New public `GET /settings/fx-rates`, a `CurrencyProvider` with the choice in localStorage, and a `<Money>` client component so the SSR listing page keeps its canonical price in the HTML for SEO while conversion is progressive enhancement (first render is always GBP, so there is no hydration mismatch). **Applied to browsing prices only** — search, listing detail, similar listings, compare. Commissions, owner asks and deal snapshots stay GBP: re-denominating a contractual figure at today's rate would imply a price nobody agreed to. Converted output is prefixed `≈` and labelled *approx.* for the same reason. **Compare:** `/compare` lines up to four listings side by side with the better value highlighted per row (lower price and £/m², higher beds/baths/area) — and highlights nothing when the values are equal, since a row of green ticks tells the reader nothing. Shortlist is per-browser, not per-account: comparing happens in one sitting and often before signup, so gating the most useful screen behind a form would be self-defeating; favourites remain the durable cross-device list. **Bug found by testing:** `toggle` closed over a stale `ids`, so several clicks in one tick overwrote each other and adding three listings quickly kept one — now functional updates throughout. Verified live: conversion (£2,000 → ≈₺104,000 at the seeded 52.0), the four-item cap disabling all remaining buttons, and the table rendering with units. |
| 16 | §6.1 region landing pages + sitemap (SEO acquisition) | ✅ **Done** | 2026-09-02 | The plan calls the web app SEO-critical (§1) but nothing existed to rank: the homepage linked regions straight into filtered search, and there was no sitemap or robots.txt at all. Now `/[locale]/region/[slug]` for all six regions × four locales, each with its own title, description, hreflang alternates, `CollectionPage` JSON-LD and region intro copy. **Rendered on demand with a 5-minute revalidate, deliberately not prerendered:** the first attempt used `generateStaticParams`, which made the build fetch from the API — and nothing guarantees one is running when the bundle is built. CI caught it (all 24 exports failed), and it would have broken production deploys too, since `up -d --build` builds the web image before the API container serves. A crawler still gets fully server-rendered HTML, so nothing is lost. **Verified by rebuilding with the API stopped**, which is the condition that actually failed. New public `GET /regions/:slug` returns the stats a foreign buyer arrives without: listing count, **separate** sale and rent bands (averaging a £200k purchase with a £900 rent would describe nothing), and **median rather than mean** so one £3m villa cannot drag a region's figure somewhere no actual listing sits. Stats use the public list price on mediated resales, never the owner's ask (§13.5). The **deed-type breakdown is first-class** rather than a buried filter — in the TRNC the deed is the most consequential thing about a property and the thing an overseas buyer least expects — and is suppressed under five listings, where a percentage is noise dressed as insight. `sitemap.ts` (132 URLs with hreflang) and `robots.ts` (dashboard/auth disallowed). **Two defects caught in the browser:** the per-m² hint rendered in £ under a headline converted to ₺, and the page took its name from the API's `name_i18n`, whose seeded ru/fa values are still the English string — so the Russian and Farsi page titles, the entire point of those pages, read "Lefke". Both fixed; titles now localise properly. 15-check e2e suite ([region-page-flows.mjs](apps/api/test/e2e/region-page-flows.mjs), `test:e2e:regions`, in CI) asserting on deltas so it passes against both an empty CI database and the demo-filled dev one. 1051-key parity. |
| 17 | §6.1 calculators: instalment calculator + developer payment schedules | ✅ **Done** | 2026-09-02 | The last substantial §6.1 item. **Payment plans already existed** end to end (DTO, developer editor, public project page) but rendered as a summary line — "30% down · 24 monthly · 20% on delivery" — which gives the shape of a deal and none of the money. `PaymentSchedule` resolves a plan against a **real unit price** (defaulting to the cheapest available unit, which is the number a browsing buyer is hunting for) and the delivery date into dated rows with a total. **Two data problems it surfaces rather than hides:** a plan whose percentages exceed 100% would render negative instalments, so it refuses and says the developer must fix it; and instalments that run past the delivery date are flagged, because that means the plan and the project timeline disagree. Rows sort chronologically — found by reading the real output, where instalment 24/24 was printing *after* the on-delivery payment. **Instalment calculator** on listing pages: deposit %, term, rate → monthly, total and interest. Framed as instalments, not a mortgage, and says so — TRNC purchases by overseas buyers are overwhelmingly cash or developer terms, and quoting a mortgage would imply financing this platform cannot arrange. Amortisation verified against a known reference (£200k at 5% over 30y = £1,073.64) and the zero-rate path. Both render through `<Money>`, so they follow the currency switcher. **The new i18n guard earned itself immediately**, catching Turkish `planLabel` on its first real use — allowlisted with a reason, since "Plan" is the Turkish word too. |
| 18 | §6.2 agent-mandate e-sign (§13.4) | ✅ **Done** | 2026-09-02 | Carried forward since Phase 2: the `agent_mandate` contract kind existed in the enum and **nowhere in the code**, so an agent could publish someone else's private resale with nothing signed at all — an odd gap in a platform whose premise is that the paperwork was checked. `Contract.assignmentId` (nullable, mirroring `dealId`) scopes a mandate to the assignment rather than a deal, because a mandate is signed long before any buyer exists and survives the deal that may never happen. Generated on acceptance by either party, idempotent, signed by owner **and** agent through the existing typed e-sign. Its clauses state the three things that make §13.4 unusual and therefore worth writing down: the owner stays anonymous, the agent's commission sits *on top of* the owner's ask rather than inside it, and the appointment lapses on a fixed date. **Publishing is gated behind `mandate.required_before_publish`, default OFF** — following the `offers.enabled` precedent, so the document and signing flow are complete and flipping the setting makes it load-bearing without a code change or breaking a live deployment. **Bug the suite caught:** the owner got a 403 reading the PDF they were being asked to sign — the document guard understood deal parties but not assignment parties, though its own comment already argued the counterparty must be able to read what they sign. Also fixed a bare `null` response that would have made the web client's `res.json()` throw; wrapped as `{ mandate }`, matching the existing `{ contract }` on the deal route. 22-check e2e suite ([agent-mandate-flows.mjs](apps/api/test/e2e/agent-mandate-flows.mjs), `test:e2e:mandate`, in CI). |
| 19 | Non-English contract PDFs (§7, §6.2) | ✅ **Done (EN/TR/RU); FA deliberately out of reach** | 2026-09-03 | Two separate problems wearing one name. **Glyphs:** the renderer used pdf-lib's built-in Helvetica, which is WinAnsi-only — Turkish ı/ş/ğ were transliterated and Cyrillic dropped entirely, so a Russian party signed a document with their own name spelled in Latin. Now embeds DejaVu Sans via `@pdf-lib/fontkit`, subset per document (~24KB, not 739KB). **Content:** every clause was a hardcoded English string; wording moved to [contract-copy.ts](apps/api/src/modules/contracts/contract-copy.ts) with full EN/TR/RU tenancy *and* mandate text, kept separate because it is prose a lawyer may revise and a clause list must be diffable. The locale is the generating party's, recorded on the contract at generation — one contract, one language, so the two parties never see different documents. **Farsi is deliberately English, and says so on the page.** The font has the glyphs, but pdf-lib has no shaping engine: measured on this face, shaping "سلام" yields 3 glyphs where a naive per-codepoint lookup yields 4 different ones, so embedding the font alone would produce disconnected letters in the wrong order. Unreadable text in a document someone signs is worse than English text. The notice is written *in English* — the circularity being that a notice in the script we cannot draw would be stripped to nothing. Arabic ranges are now stripped rather than mis-drawn, so a gap is a louder signal than mangled glyphs. Proper FA needs a shaping pass (`fontkit.layout` feeding positioned glyphs) or an HTML-to-PDF renderer. **Verified by rendering all three and reading them back**: PDF titles come out `Konut Kira Sözleşmesi` and `Договор аренды жилого помещения`, and the ToUnicode maps confirm ş/ı/ğ and Д/о/г are genuinely drawn rather than transliterated. Mandate suite extended to 27 checks with a full Russian-owner path asserting the rendered title reads `Агентский мандат`. **Regression caught while localising:** moving units into the copy module briefly left "Term: 12" with no unit — units now translate with the number. |
| 20 | Purchase & off-plan sale-agreement templates (§7) | ✅ **Done** | 2026-09-03 | Both purchase pipelines reached `contract_signing` and produced nothing — `generateForDeal` refused anything that was not a rental, so a resale or off-plan buyer signed whatever PDF someone attached by hand. Two new contract kinds rather than one: a resale sale agreement and an off-plan one are materially different documents, and the deal already distinguishes them by `projectUnitId`. **Resale clauses** cover price and payment, title and deed type, the purchase permit, Land Registry transfer, and what happens to the deposit on withdrawal — including that it returns in full when the permit or the title search is what failed. **Off-plan clauses** replace those with a stage-payment schedule, a delivery date whose linked payments fall due on *actual* delivery rather than the original date, snagging on handover, and registering the contract to protect the buyer's interest before transfer. Full EN/TR/RU. **The deed type is named, not paraphrased** — in the TRNC it decides what a buyer actually receives, and a loose description in a signed document would be worse than the term itself. **Bug caught while wiring it:** party role names were resolved from a per-kind English map *before* the locale was known, so a Russian contract would have named its parties "Buyer" and "Seller" — the same half-finished job the font work had just fixed one layer down. Suite extended to 32 checks, driving a real resale through mandate → publish → offer → contract stage and asserting the rendered PDF is titled as a sale agreement. |

**Where the code stands:** schema (all §5 tables) migrated + seeded (7 roles, 31 permissions,
21 verification requirements, 6 regions, purchase + rental + project_purchase pipeline templates). API boots on :4000,
web on :3000. `docker compose up -d` → `npm install` → `npm run db:migrate && npm run db:seed` → `npm run dev`.

**Phase 2 (§10.2) is complete** as of 2026-08-21 — the Expo app was the last item. **§6.1 is still only partly built** beyond the alerts added in step 14: the **polygon-draw filter and POI layers** are the only §6.1 items still unbuilt (compare view and multi-currency landed in step 15; region landing pages and the sitemap in step 16; calculators and payment schedules in step 17). Sorting by price/m² is already wired into Meilisearch. **Still open,
carried forward:** the mobile app covers the customer core only, so the agent-facing screens (my
listings, lead inbox) and the listing wizard remain web-only by choice; **Farsi contract rendering**, which needs an Arabic shaping pass rather than a font
(step 19 covers EN/TR/RU). (§6.2 agent-mandate e-sign landed in step 18; purchase and off-plan sale
agreements in step 20, so every pipeline now generates its own document.) §13.2 **review moderation** was built in step 13; the one piece of it still
outstanding is ID-level ban durability — a banned person cannot reuse their **phone**, but blocking a
re-registration that uses a new number and the same government ID needs document-hash matching, which
the §4 fraud tooling raises as an *alert* today rather than a block. Notification channels are code-complete but
**unconfigured**: set `RESEND_API_KEY` and `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` at deploy,
and register the WhatsApp templates named in `apps/api/src/modules/notifications/templates.ts`
with Meta in each of the four languages.

> **Verifying the mobile app in a browser:** `npm run web -w apps/mobile` renders it through
> react-native-web, but the Browser pane's synthetic clicks do **not** drive react-native-web's
> `Pressable` (it listens for PointerEvents). Dispatching `pointerdown`/`pointerup`/`click` via the
> JS console does work, and is how the flows above were exercised. Controlled `TextInput`s likewise
> need the native value setter plus a bubbling `input` event. Nothing about this is an app defect.

> **Translation debt — CLEARED 2026-09-02.** `ru.json` and `fa.json` were roughly half untranslated by
> value (440 and 438 of 1051 strings byte-identical to English) even though key parity passed, because a
> key-set check cannot see an untranslated *value*. All 436 were translated; what remains identical is
> only the brand name, an example email/phone, and `Push`/`WhatsApp`, which are the terms actually used
> in those languages.
>
> The same debt existed in **seeded data**, which the locale files never covered: `seed.ts` wrote the
> English region name into the `ru` and `fa` slots of `regions.name_i18n`, so a Russian reader saw
> "Kyrenia" in the region dropdown and in the landing-page title. Fixed at the source — and the upsert's
> `update: {}` was changed to actually write, since as it stood a corrected translation would never have
> reached an already-seeded database.
>
> **Guarded in CI since 2026-09-02** by `apps/web/scripts/check-i18n.mjs`, which runs as the web
> workspace's `test` script. It checks three things, not one: key parity, ICU-aware placeholder
> parity (so a lost `{count}` fails the build rather than throwing at runtime), and untranslated
> values. The last uses an **allowlist, not a ratio** — a threshold silently tolerates whatever is
> already broken and only ever creeps upward, whereas a named exception has to be argued for. All
> three failure modes were verified by deliberately breaking a locale file.

> **Local infra note:** the Redis host port is overridable via `REDIS_PORT` (compose defaults to
> `6379`) for machines where another project already holds 6379.

### Change Log (spec/role/requirement changes made on request)

| Date | Change | Requested by | Sections touched |
|---|---|---|---|
| 2026-07-10 | Initial build started from this spec; added this Status & Change Log section as a living tracker | Mehdi | §0 (new) |
| 2026-07-10 | **Account type is chosen at registration**, not self-service from the dashboard. Signup (OTP or email) offers Customer / Owner / Solo Agent / Agency / Developer; everyone still gets the customer baseline, professional types start `pending`. The dashboard "Add a role" cards and the `POST /users/me/roles` endpoint were removed; granting additional roles later is an admin action. Multi-role support in the data model (§2.2) is unchanged. | Mehdi | §2.2 (note), §10.1 step 2 |
| 2026-07-12 | **Major mechanics expansion** (full detail in new §13): (a) Developer & Agency become **organization accounts** — an org admin manages member accounts (create/edit/remove), members maintain portfolio/listings; (b) professional **analytics dashboards** incl. developer project comparison within and across regions; (c) **public performance stats** per agency member + agency totals (rents/sales counts); (d) **profile reviews** writable by users, non-deletable by the profile owner, report → admin moderation → warnings → identity-backed ban; (e) **star/reward tiers** from performance data (rules TBD, future update); (f) **subscription-gated listing uploads**, tiered subscriptions per user type, higher tiers unlock premium properties (details TBD); (g) **Find-my-agent private resale flow** — verified resale stays non-public, owner assigns N agents (N admin-configurable, default 2–3) for 1–6 months, agents accept/reject, reassignment after expiry; (h) **platform profit bands by price range**, fully admin-configurable, agent adds own commission then publishes; all mediated listings visible in main admin dashboard; (i) chat contact-detection extended to **social-media IDs** in addition to phone/email. | Mehdi | §13 (new), §2.2, §6.4, §6.5, §9 |
| 2026-08-31 | **AI integration is planned but explicitly deferred** — raised by Mehdi while scoping post-Phase-2 work. No AI API is to be wired in yet; the near-term build follows the unbuilt §6.1 discovery surface instead. Record candidate uses as they come up (listing description drafting, search-query parsing, chat translation — the last already sits in Phase 3) so the seams are known before anything is integrated. | Mehdi | §0 (this row) |
| 2026-08-10 | **Offers deactivated for now.** Making an offer is switched off behind a live admin toggle (`offers.enabled` platform setting, default **false**) rather than removed: the negotiation flow, the offer→counter→accept state machine and the offer-accept that opens a property deal room are all intact and return the moment the flag is flipped. `POST /properties/:id/offers` and `/offers/:id/counter` refuse while it is off; **`/offers/:id/respond` is deliberately still open** so any offer already in flight when the switch is thrown can be closed out. The flag is published in `GET /settings/public`, so the web hides the Offer tab on the listing page and the Offers entry in the dashboard nav, and a direct visit to the offers page explains itself. **Consequence to be aware of:** offers are the only route that opens a *property* deal room, so while this is off no new property deals can start — project-unit reservations still create deals normally, and existing deals are unaffected. | Mehdi | §0 (this row), §6.2, §7 |

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
