# Security / RBAC audit — Phase 1 hardening (2026-07-16)

Automated route enumeration + manual review of all **87 API routes**.

## Guard model
Two global guards run on every request (registered as `APP_GUARD`):
1. **JwtAuthGuard** — every route requires a valid access token unless marked `@Public()`.
2. **PermissionsGuard** — routes with `@RequirePermissions(...)` are checked against the
   DB-driven `role_permissions` table; deny-by-default.

Coverage: **16 PUBLIC · 43 permission-guarded · 28 authenticated-only**.

## Authenticated-only routes (28)
These carry no `@RequirePermissions` and instead enforce **ownership / deal-party membership
in the service layer** — the correct pattern for resources scoped to the caller:
- `users/me/*` (profile, notifications, subscriptions, offers, viewings, conversations) → scoped to `user.sub`.
- `documents/:id/url` → returns a signed URL only to the document owner **or** a holder of
  `verification.review` (checked inside the controller).
- `offers/:id/counter|respond`, `viewings/:id/status` → deal/viewing **party** enforced in
  `OffersService` / `ViewingsService` (both buyer and lister legitimately act, so a single static
  permission does not map — Plan §3 defines deal participation as party-based).
- Class-level `@RequirePermissions` covers `VerificationController` (`verification.review`),
  `DealsController` (`deal.participate`), `AdminSettingsController` (`user.manage`).

## Public routes (16) — reviewed, all intentional
`health`, `root`, `regions`, `roles`, `roles/:key/requirements`, `plans`, `settings/public`,
`search/listings`, `properties/:id`, `users/:id/reviews`, and the six auth endpoints
(`login`, `register`, `logout`, `refresh`, `otp/request`, `otp/verify`). Auth endpoints are
rate-limited (see below).

## Findings & fixes
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | **High** | `GET /properties/:id` (public) returned internal identity fields (`createdByUserId`, `publishedByAgentId`, `onBehalfOfOwnerId`, `mandateDocumentId`) on the non-owner payload — breaking owner/agent anonymity (§13.4). | Stripped all four from the public response; only the owner sees them. |
| 2 | Medium | `GET /users/:id/reviews` (public) exposed each review's `raterId`, de-anonymizing reviewers. | Removed `raterId` from the public payload. |
| 3 | Low (by design) | `offers/:id/respond|counter` and `viewings/:id/status` are auth-only. | Left as-is — party membership is enforced in the service; documented here. |

Verified already-correct: public property + search never expose the profit/commission breakdown
(§13.5, only the final buyer price is shown); `verified_private` resales 404 to the public;
documents are never public (signed-URL gate).

## Rate limiting
Global default 120 req/min. Tightened per-endpoint:
- `auth/otp/request` 5/min, `auth/otp/verify` · `auth/login` · `auth/register` 10/min.
- `properties/:id/inquire` 10/min, `conversations/:id/messages` 30/min.

## Deferred to later hardening
- Move cron jobs (freshness, assignment-expiry, rating-reveal) to BullMQ for multi-instance safety.
- Socket.io realtime for chat (currently 4s polling).
- Sentry error tracking + pino structured logging.
- Playwright e2e on the 5 critical flows in CI (needs service containers).
