# "The place" — the İskele film, and how to remake it

> Since 2026-09-11 this film is the page's mid-page **chapter**, not its
> opening: the hook is now "The Climb" (see STORY.md). It runs after the
> verification sequence as the reward — the island itself — at 220vh, with a
> chapter title instead of the h1, no header, and nothing fetched until the
> reader is within a viewport of it (`eagerFirst={false}`).

The three-shot scroll-driven film. The shots came from
**Mehdi's own footage of the İskele development** (`assest/`, 14 vertical
phone clips), taken through Higgsfield rather than used raw — so what is on
screen is really the development, but with cinematic camera language and one
consistent grade instead of fourteen different phone pans.

Nothing here is committed to git. Everything lives in the media bucket under
`landing/`, served through `${NEXT_PUBLIC_API_URL}/media/landing/…` (Caddy
proxies that path to the public bucket; MinIO serves the same shape locally
on port 9200 — see `NEXT_PUBLIC_MEDIA_URL`).

## The three shots

| Shot | Bucket files | Source clip | Beat over it |
|---|---|---|---|
| 1 · arrival | `film-1-sea.mp4` + `.webp` | `IMG_0411.MOV` @ 8s — open sea at golden hour | h1 + search box |
| 2 · the place | `film-2-dusk.mp4` + `.webp` | `IMG_7265.MOV` @ 4s — pink dusk over the villas and pool | "Everyone shows you the view." |
| 3 · home | `film-3-home.mp4` + `.webp` | generated to match their interiors | "We show you the deed, the owner, and the date it was last confirmed." |

Plus `band-golf.webp` — `IMG_4617.MOV` @ 7s, the golf course under the
Beşparmak ridge, used as the page's image band.

The narrative is the positioning, not decoration: shot 1 makes the promise
and takes the search, shots 2 and 3 turn from what every property site shows
you to what this one checks, and hand straight into the verification
sequence below, which shows exactly that on a listing card.

## The pipeline, per shot

Every clip in `assest/` is **1080×1920 portrait** (phone, with `rotation=-90`
metadata — `ffprobe` reports 1920×1080, so always check `stream_side_data`).
Getting to a 16:9 cinematic shot therefore takes an expand step.

1. **Pull the frame** at full resolution:
   `ffmpeg -ss <t> -i assest/<CLIP>.MOV -frames:v 1 -q:v 2 ref.jpg`
2. **Upload** it: `media_upload` → `PUT` the bytes to the presigned URL →
   `media_confirm`.
3. **Expand to 16:9**: `outpaint_image` with `aspect_ratio: "16:9"` (2
   credits). This is what makes a portrait phone frame into a wide shot while
   keeping the real architecture in the middle; it held up well on all three.
4. **Animate**: `generate_video` / `generate_video_batch` with
   `cinematic_studio_video_v2` — `start_image` = the outpaint's job id,
   `duration: 5`, `mode: "pro"`, `sound: "off"`, `speedramp: "linear"`,
   `cfg_scale: 0.6`, `aspect_ratio: "16:9"` (7.5 credits). Prompt the camera
   move explicitly ("slow steady cinematic aerial drift forward…", "smooth
   gimbal, no camera shake, no people, no text"). Output is 1928×1076 @ 24fps.
   - If a call comes back `submission_failed` with a `preset_recommendation`,
     resubmit with `declined_preset_id` set to that preset's id.
5. **Encode** — ping-pong loop, so a shot the viewer stops on breathes
   instead of hard-cutting back to frame one. The reverse half drops its
   first frame or the boundary frame shows twice:

```
fc="[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,\
eq=contrast=1.04:saturation=1.06,setpts=PTS-STARTPTS,split[a][b];\
[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1[v]"

ffmpeg -i raw.mp4 -filter_complex "$fc" -map "[v]" -an \
  -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -movflags +faststart film-N.mp4
ffmpeg -i raw.mp4 -frames:v 1 -vf "scale=1280:720:force_original_aspect_ratio=increase,\
crop=1280:720,eq=contrast=1.04:saturation=1.06" -quality 80 film-N.webp
```

**H.264 only, on purpose.** VP9 was encoded and measured against it: for this
footage it came out *larger* at matched quality (the sea shot: 1.37 MB VP9 vs
868 KB H.264 — moving water is compression-hostile and libvpx handled it
worse). One universally supported codec also removes a negotiation failure
mode. Use `crf 28` for architecture and interiors, where banding on flat
walls would show, and `crf 34` for water, where it does not.

## Budget

Measured off the network layer, cache disabled:

- **First paint**: shot 1 (849 KB) + its poster (92 KB) + the two beat
  posters the no-JS markup pulls in (90 KB) + fonts (59 KB) + production
  JS/CSS (~116 KB) ≈ **1.2 MB**, against an 8 MB limit.
- **Whole page, everything scrolled**: ≈ 2.9 MB in production.
- Shots 2 and 3 are not fetched until the scroll approaches them, and only
  one video ever decodes at a time (verified: at each act the other shots
  report `paused: true`).

## Swapping a shot

Replace the files in the bucket under the same names — no deploy, no code
change. `ScrollFilm`'s `shots` prop in `page.tsx` names the three basenames
and each one's `object-position`; that is the only place the ids appear.
