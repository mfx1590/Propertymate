# Start messages for the next sessions

Two windows run in parallel from 2026-09-10. Paste the block for the window
you are opening. Each is complete on its own.

---

## Window A — main track

```
Continue building Propertymate (C:\Users\mehdi\Desktop\Propertymate).

Read Plan.md §0 first — the master spec and the living status log, current
through step 28. My memory files have the ops gotchas and standing decisions.

STATE: main is at the tip of origin/main — run `git log --oneline -1` (it was
cde818b when this was written). Confirm CI is green on that tip with
`gh run list --limit 1` before building on it. The repository is PUBLIC since
2026-09-10 (Actions minutes): never commit anything that must stay private.
Phases 1 and 2 complete;
§6.1 complete; Phase 3 built except the items gated on me. Deployed on
propertymate.tech (Hostinger KVM 2, Caddy TLS) — the VPS is at 29f1b46, the
later commits are docs only. Runbook: DEPLOY.md at the repo root.

BEFORE ANYTHING: Docker Desktop is usually not running after a reboot — start
it, then `docker compose up -d --wait`. MinIO is on 9200/9201 here. Stale
`nest start --watch` processes may hold :4000 — check before trusting an API.
Set AUTH_THROTTLE_BYPASS=1 on any API you run e2e suites against.

A SECOND WINDOW is building the landing page in a SEPARATE WORKTREE at
C:\Users\mehdi\Desktop\Propertymate-landing on branch `feat/landing` (same
repository, different directory — `git worktree list` shows it). It owns
apps/web/src/app/[locale]/page.tsx, apps/web/src/components/landing/**, the
`home` i18n namespace and the landing media. Do not touch those paths, do
not `git checkout feat/landing` here, and never `cd` into that directory.
Ports: you own web :3000 and the API :4000; the landing window uses web :3100
and no API of its own. Pull before every push.

MINE, NOT YOURS: RESEND_API_KEY (still unset on the VPS), the WhatsApp
credentials, plan prices (§13.3 tiers), and the lawyer/acquirer conversations
that gate card collection, success-fee invoicing and escrow.

WHAT IS LEFT FOR YOU — ask before starting anything else:
- A seeded-but-unread audit: three Phase-1 seeds turned out to have no reader
  (injectableServiceTypes, the `withdrawn` status, audit.view). Grep for the
  rest.
- Ops hardening from DEPLOY.md "what this setup is not": off-site backups,
  documents to R2, Sentry.
- Other service types (furniture, movers, insurance, property_management,
  notary_translation) are still seams — the lawyer module is the template.
- Chat translation stays deferred (AI decision, 2026-08-31).

HOUSE RULES:
- Update Plan.md §0 after each completed step; record spec changes I request
  in its Change Log.
- Every feature gets a self-contained e2e suite in apps/api/test/e2e/ wired
  into CI. Suites create every row they assert on and undo global state in
  `finally`.
- ALWAYS check CI after pushing (`gh run list --limit 1`) and watch it to
  completion. Local green has hidden clean-database, no-API-at-build and
  timing-race failures.
- Offers stay OFF (offers.enabled). Mandates stay unenforced. Do not flip
  either without asking. No AI API integration.
- Do not tell me something is done until CI is green on it.
```

---

## Window B — landing page

```
Build the Propertymate landing page. WORK ONLY IN
C:\Users\mehdi\Desktop\Propertymate-landing — a git worktree on branch
`feat/landing`. Never touch C:\Users\mehdi\Desktop\Propertymate, where another
window is doing feature work on `main` at the same time.

Read docs/landing-concept.md first — my full concept ("Through the Layers of
the Island"), the layer stack, the five hidden transitions, the Higgsfield
continuity rules, and the engineering constraints. Then Plan.md §0 for how
the rest of the site is built. My memory files have the ops gotchas.

STATE: the worktree is already created and `npm install`ed, branched from
the tip of main. Merge to main by pull request when done (`gh pr create`).
Pick up the other window's changes with `git merge main` whenever you need
them — conflicts are impossible outside your own paths, because the other
window never edits them. Memory is per-directory: this window starts with
NO memory files, so everything you need is in this message and the two docs.

The repository is PUBLIC: never commit anything that must stay private, and
never commit the plates (media bucket only).

YOU OWN ONLY: apps/web/src/app/[locale]/page.tsx,
apps/web/src/components/landing/**, the `home` namespace in
apps/web/messages/*.json, and the `landing/` prefix in the media bucket. Do
not touch anything else; pull before every push.

BEFORE ANYTHING: Docker Desktop is usually not running after a reboot — start
it, then `docker compose up -d --wait` (shared infra; MinIO is on 9200/9201
here). Run the web dev server with preview_start "web-landing" (port 3100 —
port 3000 belongs to the other window). Do NOT start an API: point
NEXT_PUBLIC_API_URL at the other window's http://localhost:4000 if it is up,
otherwise at https://api.propertymate.tech — you only need the public
/regions endpoint and the media bucket. Never run prisma migrate here.

PLATES: I generate them in Higgsfield. Tell me exactly what to generate —
per layer: prompt with the master suffix, size at 1.5× display width, which
need the transparent cutout variant, loop length, and file names matching a
manifest you define. I upload them to the media bucket under landing/; you
never commit them to git.

WHAT DONE MEANS:
- The page keeps every job the current homepage does — search box, region
  links, how-it-works, trust pitch — server-rendered for SEO, with the
  parallax as progressive enhancement over it.
- Verified in the browser at en, tr, ru and fa (RTL), and with
  prefers-reduced-motion emulated (static poster composition, no video).
- `NEXT_PUBLIC_API_URL=http://127.0.0.1:9 next build` succeeds — nothing
  fetches the API at build time.
- The i18n guard passes (`npm run test -w apps/web`).
- Under 8 MB on first paint; layers below the scroll fold lazy-load.
- CI green on the PR before you call it done.

HOUSE RULES: record what you build in Plan.md §0 when it merges; do not
re-litigate standing decisions; no AI API integration.
```
