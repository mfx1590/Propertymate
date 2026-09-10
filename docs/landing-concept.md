# Landing page — "Through the Layers of the Island"

Specified by Mehdi on 2026-09-10. Built in its **own session on branch
`feat/landing`**, separately from feature work on `main`; see *Ownership* at
the end for the boundary. Plates are generated with **Higgsfield**.

---

## Core idea

The camera never cuts. It moves forward and downward through 7 depth layers,
and each layer becomes the mask that reveals the next. Because each
Higgsfield plate is generated with a matching horizon line, sun angle (~35°
from top-left, golden hour) and focal length, they stack without seams.

## The layer stack (back → front)

| # | Layer | Depth / scroll speed | Role |
|---|---|---|---|
| L0 | Sky gradient + sun | 0.1× (almost static) | Constant backdrop for the whole sequence, keeps light consistent |
| L1 | Distant sea + horizon | 0.25× | Sea surface loop, slow shimmer |
| L2 | Five Finger mountain silhouette | 0.4× | Long ridgeline, dark blue haze |
| L3 | Mid coastline: Kyrenia castle, harbour, olive terraces | 0.6× | Main "place" layer |
| L4 | Near foreground: pine trees, villa rooftops, pool edge | 0.85× | Occluders |
| L5 | Close foreground: bougainvillea, stone arch, terrace railing | 1.2× | Wipes across frame |
| L6 | Interior: curtain, doorframe, glass | 1.5× | Final reveal frame |

Faster layers cover slower ones, which is what sells the depth.

## The five transitions, and how each one is hidden

1. **Cloud wipe** (opening → coastline). Start above a thin cloud deck
   (L5-position cloud plate, high-speed parallax). As you scroll, a cloud
   sweeps left-to-right across the full frame. While the frame is 100% cloud,
   L1–L3 swap in underneath. When the cloud clears, we're already looking at
   the coast. The viewer never sees a cut.
2. **Ridge occlusion** (coastline → mountains). The camera drifts sideways;
   the L2 mountain silhouette rises from the bottom because of its parallax
   offset, covering the harbour. Behind the ridge you place the next mountain
   plate (Bellapais valley side). The ridge's top edge is the wipe. Generate
   L2 with a hard alpha edge so it can hide anything behind it.
3. **Tree-trunk pass** (mountains → neighbourhood). A single dark pine trunk
   (L5) crosses the frame at 1.2×. It's wide enough to cover the whole width
   for ~6 frames — that's where the valley plate becomes the terrace/pool
   plate. Classic match-cut trick, but driven by scroll.
4. **Arch push-through** (neighbourhood → villa exterior). A stone arch on L5
   grows as the camera "approaches." The inside of the arch is a masked window
   showing the villa's terrace. Scrolling pushes the arch's edges out past the
   frame; you are now inside the terrace scene without a cut.
5. **Curtain reveal** (terrace → interior). A sheer linen curtain (L6, slight
   wind loop) drifts across; the camera moves past it into the room. The blur
   of the curtain is the last wipe. The frame settles on the open doorway
   looking back at the sea — a calm hold where the motion-graphic UI can then
   enter.

## Continuity rules for the Higgsfield plates

- One master prompt suffix for every generation: same time of day, same haze
  colour, same lens (35mm-equivalent), horizon at 40% frame height.
- Generate every occluder layer (L4, L5, L6) twice: once as full plate, once
  as isolated cutout with transparent background (`remove_background` on a
  solid-colour version). Cutouts are what let layers cover each other cleanly.
- Every layer is generated at 1.5× the display width so parallax movement
  never exposes an empty edge.
- Motion inside plates is subtle loops only: sea shimmer, leaf sway, curtain
  drift, heat haze. Big movement belongs to the scroll, not the video, or the
  layers stop matching.
- Micro-detail on faster layers (sharp leaves, stone texture), soft haze on
  slower layers. This atmospheric perspective is what makes the depth read as
  real instead of "cardboard cutouts."

## Two extra touches

- Mouse-driven tilt of ±3° on L4–L6 only; the background stays still. Feels
  holographic.
- A single warm light leak (L6-level, very fast) crosses at transition 4 to
  add a cinematic flare exactly where the scene changes.

## Alternative concept — "Water Line"

The camera starts underwater off the north coast, rises through the surface
(the water surface is the wipe — half-submerged dome-port look), skims across
the beach, climbs the cliff via terraces, and enters the villa from its
infinity pool. Same layer logic, but the transitions are water-based instead
of foliage/stone, which reads very Mediterranean and very distinct from every
other property site.

---

## Engineering notes for the landing window

These are the constraints the page has to live inside. They come from how
the rest of the platform is built and deployed, and none is optional.

**What it replaces.** The current homepage is
`apps/web/src/app/[locale]/page.tsx` (132 lines): a hero with a region
search box, a "browse by region" strip, a three-step "how it works", and the
trust pitch. Its copy lives in the `home` namespace of
`apps/web/messages/{en,tr,ru,fa}.json`. The new page keeps every one of those
jobs — the search box, the region links, the trust pitch are what the page
is *for*; the parallax is how it arrives at them.

**SEO text stays server-rendered.** The homepage is the SEO surface (Plan
§1). Headline, sub-headline, region links and the trust copy must be in the
HTML the server sends, not painted after the plates load. The parallax canvas
is progressive enhancement over a page that is complete without it.

**Plates are never committed to git.** Seven layers × two variants × loop
video is tens of megabytes. Upload them once to the media bucket under
`landing/` and serve them at `https://api.propertymate.tech/media/landing/…`
— Caddy already proxies that path to the bucket, and the bucket is public.
Reference them by absolute URL from `NEXT_PUBLIC_API_URL`. Locally they come
from MinIO the same way. Keep a manifest (`landing/manifest.json`) naming
every plate, its layer, speed and role, so the page is data-driven and a
re-generated plate is a file swap.

**Format per plate.** Loops as WebM (VP9/AV1) with an MP4 (H.264) fallback
for Safari; the transparent cutouts need alpha — WebM/VP9 with alpha, or an
image sequence / APNG for the short ones. Every plate ships with a poster
frame (WebP). Target under **8 MB total on first paint**; lazy-load layers
below the fold of the scroll.

**`prefers-reduced-motion` is a first-class path**, not a fallback: it
renders the poster frames as a static stacked composition with no
scroll-linked movement and no autoplaying video. The four-locale RTL rule
applies — the `fa` page mirrors layout; the plates do not.

**Nothing may fetch the API at build time.** CI's build job has no API. The
region list on the page is fetched on demand with `revalidate`, the way every
other public page does it; the plate manifest is static.

**Scroll driver.** Use the scroll position as the single timeline; each layer
maps scroll → transform by its speed factor. No physics, no easing that can
drift between layers — the whole effect depends on the plates staying
registered. Respect the existing i18n guard (`npm run test -w apps/web`),
which fails on missing keys, lost placeholders or untranslated values.

**Verification is in the browser**, at all four locales and with reduced
motion emulated, plus `next build` against an unreachable API. The landing
has no API surface, so it adds no e2e suite; the web build and i18n guard in
CI are its gates.

## Ownership

| Path | Owner |
|---|---|
| `apps/web/src/app/[locale]/page.tsx` | landing window |
| `apps/web/src/components/landing/**` | landing window |
| `home` namespace in `apps/web/messages/*.json` | landing window |
| `landing/` prefix in the media bucket | landing window |
| everything else | main window |

Both windows pull before pushing. The landing window works on
**`feat/landing`** and merges to `main` by pull request once verified; the
main window keeps committing to `main`. Neither edits the other's paths.
