# Higgsfield generation brief — landing plates

Every file below goes in the media bucket under `landing/` (never in git),
with exactly these names — the page finds them through
`landing/manifest.json`, which mirrors `manifest.ts`. A re-generated plate is
a file swap; nothing else changes. Placeholder plates with the same names are
in the bucket now, so each real plate can replace its stand-in one at a time.

## Master prompt suffix (append to every generation)

> …, golden hour on the north coast of Cyprus, low warm sun 35° from
> top-left, soft amber haze, 35mm-equivalent lens, horizon line at 40% of
> frame height, cinematic wide still, photorealistic, no people, no text,
> no birds

Same suffix, every plate — the whole stack only fuses if time of day, haze
colour, lens and horizon height never vary between layers.

## Shared rules

- **Stills and cutouts**: 2880px wide (1.5× the 1920 display width) unless a
  bespoke canvas is listed. Export WebP, ≤ 500 KB. Cutouts keep a real alpha
  channel (generate on a solid colour, then `remove_background`).
- **Video loops**: generate at 1920×1080, seamless loop, subtle motion ONLY
  (shimmer, sway, drift — big movement belongs to the scroll). Encode:
  - Opaque loops → WebM/VP9 (≤ 2 MB) **and** MP4/H.264 fallback (≤ 2.5 MB):
    - `ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 1M -pix_fmt yuv420p -an out.webm`
    - `ffmpeg -i in.mp4 -c:v libx264 -crf 26 -pix_fmt yuv420p -movflags +faststart -an out.mp4`
  - Alpha loops (sky visible above the silhouette) → VP9-alpha WebM only,
    ≤ 2.5 MB — H.264 cannot carry alpha, so **no MP4 for these**:
    - `ffmpeg -i in.mov -c:v libvpx-vp9 -b:v 1.2M -pix_fmt yuva420p -auto-alt-ref 0 -an out.webm`
  - Every video also ships a poster: its first frame as WebP (with alpha for
    alpha loops), ≤ 400 KB, named `<plate>.webp`.
- **Atmospheric perspective**: micro-detail sharp on near/fast layers, soft
  haze on far/slow ones — this is what makes the depth read as real.

## The plates

| File(s) | Layer / speed | Prompt core (add master suffix) | Loop | Alpha |
|---|---|---|---|---|
| `l0-sky.webm/.mp4/.webp` | L0 · 0.1× | Open golden-hour sky over the Mediterranean, warm gradient, sun disc upper-left, a few thin distant clouds | 10s, almost-still cloud drift + heat shimmer | opaque |
| `s0-clouds.webm/.webp` | L1 · 0.3× | Thin cloud deck seen from just above, tops lit warm, sky visible above | 8s slow drift | **alpha above the deck** |
| `t1-cloud.webp` | wipe · canvas **2880×2200** | One dense cumulus cloud bank, warm-lit; the central 70% width × 85% height must be fully opaque, wispy on all outer edges | still | alpha |
| `s1-sea.webm/.webp` | L1 · 0.25× | Distant open sea to the horizon at 40% frame height, golden light path | 8s slow shimmer | **alpha above horizon** |
| `s1-ridge-haze.webp` | L2 · 0.4× | Five Finger (Beşparmak) mountain ridgeline in blue evening haze, silhouette only | still | alpha above ridge |
| `s1-harbour.webm/.webp` | L3 · 0.6× | Kyrenia castle and horseshoe harbour with olive terraces in front, seen from above the water | 8s water sparkle | **alpha above skyline** |
| `t2-ridge.webp` | wipe · canvas **2880×3766** (portrait) | Dark mountain ridge silhouette; jagged ridgeline across the upper 30% with a **hard alpha edge**, everything from 30% down to 95% fully opaque dark blue-grey, only the bottom 5% fading to transparent haze | still | alpha |
| `s2-ridge-far.webp` | L2 · 0.3× | Farther mountain range, deeper haze | still | alpha |
| `s2-valley.webm/.webp` | L3 · 0.5× | Bellapais abbey and its valley side, olive terraces stepping down | 8s leaf sway + haze | **alpha above skyline** |
| `t3-trunk.webp` | wipe · canvas **2880×2496** | A massive dark pine trunk filling the frame vertically; the central 80% of the width fully opaque bark, pine boughs on the left/right edges | still | alpha |
| `s3-terrace.webm/.webp` | L3 · 0.6× | Hillside neighbourhood: villa rooftops, olive terraces, a pool below, sea glimpsed beyond | 8s pool water + leaves | **alpha above skyline** |
| `s3-pines.webp` | L4 · 0.85× | Near pine branches overhanging from the top corners, sharp needles | still | alpha (frame edges only) |
| `t4-arch.webp` + `t4-arch-mask.webp` | wipe · canvas **2880×2880** | Old stone arch filling the frame, golden limestone; the arch opening (centred, ≈ 28% width × 38% height, round top) fully transparent. The mask file is the SAME canvas with the opening filled solid white on transparent — export both from one generation | still | alpha |
| `s4-terrace.webm/.webp` | L3 · 0.6× | The villa's own terrace: infinity pool edge meeting the sea, stone floor, sea + sky beyond | 8s pool shimmer | **alpha above sea/sky join** |
| `s4-bougainvillea.webp` | L5 · 1.2× | Bougainvillea in bloom spilling in from a top corner and one lower corner, sharp petals | still | alpha |
| `t5-curtain.webm/.webp` | wipe · canvas motion at **2880×2496** | Sheer white linen curtain, backlit, gentle wind; semi-transparent throughout, denser in the middle band, soft blur | 6s wind loop | **VP9 alpha** (poster: alpha WebP) |
| `s5-interior.webm/.mp4/.webp` | L3 · 0.3× | Calm interior at golden hour, an open doorway centred looking back at the sea, warm shadow around it | 10s: curtain-edge drift, sea sparkle through the door | opaque |
| `s5-doorframe.webp` | L6 · 1.5× | Very near dark doorframe edges + a sliver of glass reflection framing the left/right/top of the image | still | alpha |

## Budget

First paint loads only the opening set (`l0-sky` webm+webp, `s0-clouds`
webm+webp, `t1-cloud.webp`) plus the three postcard stills the no-JS/
reduced-motion composition needs (`s1-sea.webp`, `s1-ridge-haze.webp`,
`s1-harbour.webp`) — ≈ 7.1 MB at the caps above, plus ≈ 0.3 MB of production
JS/CSS ⇒ ≈ 7.4 MB, inside the 8 MB limit with the caps as hard ceilings.
Everything else attaches only when the scroll approaches its scene
(verified: coast videos + valley stills by p≈0.3, arch/villa/curtain by
p≈0.68).

## Upload

```
mc cp <files> local/media/landing/          # dev MinIO (port 9200)
mc cp <files> <prod-alias>/media/landing/   # production bucket
```

Then update `landing/manifest.json` in the bucket only if names/roles
changed (they shouldn't — a swap needs no manifest edit).
