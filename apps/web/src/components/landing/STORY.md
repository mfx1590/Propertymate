# "The Climb" — the homepage hook

Creative treatment of record for the homepage's opening film. Built from
Mehdi's three concept frames (the man climbing the logo, the man at its
peak, the man at home inside it). The İskele footage film that used to open
the page moves further down as a chapter ("the place"); this replaces it as
the hook.

## Logline

Buying a home abroad feels like climbing a mountain of questions.
PropVerify answers them at the top — and from there it's downhill, all the
way home.

## The device: the logo is the set

The whole film happens on and inside the PropVerify mark.

| Part of the logo | What it is in the story |
|---|---|
| The steep left roof slab | the climb — every question a buyer faces here |
| The apex | the moment of verification |
| The P's curve | the easy way down |
| The P's bowl, under the roof | home |

Because the film is set inside the logo, it can end on the logo without a
cut: the camera pulls back from the man on his sofa and the lit room inside
the dark P *is* the brand mark. Story → logo, one continuous move.

## The questions are the product

The widgets that swarm him on the way up are not decoration — each is a real
question buyers in Northern Cyprus face, and each resolves at the ridge into
a check the platform actually performs (Plan §4 — nothing here is promised
that the verification engine does not do):

| On the way up | At the ridge |
|---|---|
| Is the title deed real? | Deed checked by our team |
| Does the seller actually own it? | Owner matched to the deed |
| Which kind of deed is it? | Deed type on every listing |
| Is it even still for sale? | Confirmed in the last 90 days |
| Who can I trust with this? | Verified agents and lawyers |

They are **live HTML, not baked into the video**: localised in all four
languages, crisp at every resolution, real text for accessibility, and they
can flip to a check and dissolve on scroll. The film itself carries no text
at all.

## Acts (scroll progress)

| Act | Scroll | Picture | Words |
|---|---|---|---|
| 0 · Establish | 0–10% | Golden hour. The monument on a plateau above the sea; our man at its foot, small, looking up | h1: "Buying a home in Northern Cyprus shouldn't be a climb." + search |
| 1 · The climb | 10–42% | He climbs the steep slab, straining; the questions surface around him one by one and crowd in, tethered to him | the five questions |
| 2 · The ridge | 42–58% | He hauls himself onto the apex; the sun breaks behind him | each question flips to its check and dissolves · "We check every one of them — before a listing goes live." |
| 3 · The easy way | 58–80% | Over the ridge, the far side is the P's teal curve; he walks it, then glides down it, jacket over his shoulder | "So the way down is easy." |
| 4 · Home | 80–100% | The curve delivers him into the warm room inside the P; he drops onto the sofa, coffee in hand; pull back to the full logo | "Every listing verified. Every seller real." + search |

The search box is on screen at the first frame and again at the last, so
nobody has to finish the film to use the site.

## Production

Keyframe-chained, so the film is continuous rather than a sequence of cuts:
six keyframes K0…K5 are rendered as stills with the character and the
monument held as reference elements, and each shot is a video interpolated
from Kᵢ to Kᵢ₊₁ — shot *n* ends on exactly the frame shot *n+1* starts on.

| Shot | From → to | Move |
|---|---|---|
| S1 | K0 establish → K1 first steps up the slab | slow crane up from the sea to reveal the monument |
| S2 | K1 → K2 two-thirds up | lateral tracking alongside him, wind, one slip and recovery |
| S3 | K2 → K3 standing on the apex | he hauls up, stands; sun flares behind him |
| S4 | K3 → K4 at the foot of the curve | over the ridge and down the teal sweep, easy |
| S5 | K4 → K5 on the sofa, logo pulled back | into the room; camera pulls back to the full mark |

The camera keeps him in a predictable region of the frame so the HTML
questions have somewhere to live.

## Style — decision record

Three looks were rendered from the same brief (the man a third of the way
up the slab, golden hour, the plateau above the sea), two candidates each:

| Look | Verdict |
|---|---|
| **Premium stylized 3D** (nano_banana_2 / gpt_image_2) | **Chosen.** The logo reads instantly as a monument, the slab reads as a climb, and "top animation studio brand film" is the most commercial register of the three — the language of the big consumer brands' films. Also the most forgiving for image-to-video: clean geometry, no texture crawl. |
| Cinematic photoreal surreal | Stunning, but concrete-and-tile reads as an architecture render, and one model (Seedream) broke the logo into a bowl on a pedestal. |
| Handmade miniature / stop-motion | Charming and tactile, and exactly wrong for a platform whose product is trust — toy-like where we need authority. |

Look anchor: the nano_banana_2 3D frame (job `72574763…`). Every keyframe
was generated with it as `image_references` plus the relevant one of Mehdi's
concept frames for pose intent, prompted as "same scene, same monument, same
man … same framing" — which is what kept six frames on one monument in one
light.

## Production record

| Asset | Model | Notes |
|---|---|---|
| K0 foot, K2 two-thirds, K3 apex, K4 curve, K5 home | `nano_banana_2` 2k, refs = anchor (+ concept frame) | K1 is the anchor itself |
| S1…S5 | `cinematic_studio_video_v2`, `start_image`=Kᵢ, `end_image`=Kᵢ₊₁, pro, sound off, `speedramp: linear`, `cfg_scale: 0.6`, `genre: auto` | 5/8/5/6/6 s. `genre: intimate` and some prompts trigger a preset recommendation instead of a job — resubmit with `declined_preset_id`. |
| Encode | H.264 1280×720 CRF 26, `keyint=6:min-keyint=6:scenecut=0` | dense keyframes so scrubbing seeks land within a quarter-second of decode; 6.1 MB for all five, ~1 MB at first paint |
| Posters | first frame of each shot; the last shot's is its END frame (home), because that is what the static page shows | |

The seams were checked frame-to-frame (last frame of Sₙ beside first frame
of Sₙ₊₁): same pose, same light, every time. Keyframe chaining works.

## Engineering notes

- **Two clocks, one timeline.** Fine pointer: the shots are *scrubbed* —
  `currentTime` follows the scroll, so the climb happens under the reader's
  hand and stopping mid-slab freezes him mid-strain. Touch: shots play
  through their act, one at a time, because seeking on phones stutters.
  Decided at mount from `(pointer: fine)`; dev hook `__climbSetScrub` lets
  headless verification exercise both.
- **The widgets follow the crop.** Their anchor is the climber's raw-frame
  position per keyframe, mapped to stage pixels through `object-fit: cover`
  and each shot's `object-position` — on a phone the stage shows ~26% of the
  frame's width, so without that mapping they tether to empty air.
- **`pause()` loads.** Pausing a video that never started loading runs the
  spec's resource-selection algorithm and fetches it. Every "pause the
  others" goes through `safePause`, which skips `NETWORK_EMPTY` elements.
  Found by measuring bytes, not by reading code.
- **Words physically right.** The climber is on the left of the picture and
  the picture does not mirror, so the text block is on the physical right in
  every locale (`flex-end` is logical — RTL needs `flex-start`).
- Measured first paint: shot 1 (961 KB) + its poster + fonts + production
  JS/CSS ≈ 1.3 MB against the 8 MB limit; the other four shots attach 0.06
  of the film (~28vh) before their act.
