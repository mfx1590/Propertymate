/**
 * Scroll choreography for the landing journey (docs/landing-concept.md).
 *
 * One rule from the concept governs everything here: scroll position is the
 * single timeline. Every number below is a pure linear function of global
 * progress p ∈ [0,1] — no physics, no easing that could drift between layers,
 * because the effect depends on the plates staying registered.
 *
 * Units: x in vw, y in vh, so the maths is viewport-relative and identical
 * at every window size.
 */

import type { Plate, SceneId } from './manifest';

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Local 0→1 progress of p inside [a,b]. */
export const span = (p: number, a: number, b: number): number => clamp01((p - a) / (b - a));

/** Total scroll length of the journey, in viewport-heights of travel. */
export const JOURNEY_VH = 620;

/**
 * The five transitions. `swap` is the global p at which the frame is fully
 * covered by the transition plate and the scenes exchange underneath —
 * derived from each wipe's geometry, not eyeballed (see plateFrame).
 */
export const T1 = { start: 0.10, end: 0.24, swap: 0.17 }; // cloud wipe
export const T2 = { start: 0.27, end: 0.41, swap: 0.34 }; // ridge occlusion
export const T3 = { start: 0.46, end: 0.57, swap: 0.515 }; // tree-trunk pass
export const T4 = { start: 0.62, end: 0.78, swap: 0.738 }; // arch push-through
export const T5 = { start: 0.80, end: 0.91, swap: 0.855 }; // curtain reveal

/** When each scene owns the frame. Bounds are the swap points above. */
export const SCENE_WINDOW: Record<SceneId, { start: number; end: number }> = {
  opening: { start: 0, end: T1.swap },
  coast: { start: T1.swap, end: T2.swap },
  valley: { start: T2.swap, end: T3.swap },
  neighbourhood: { start: T3.swap, end: T4.swap },
  villa: { start: T4.swap, end: T5.swap },
  interior: { start: T5.swap, end: 1 },
};

/** Preload margin: a scene's media attach this far before it is due on
 *  screen, and detach (pause) this far after it has gone. */
const PRELOAD_AHEAD = 0.12;
const KEEP_BEHIND = 0.08;

export function sceneActive(scene: SceneId, p: number): boolean {
  const w = SCENE_WINDOW[scene];
  return p >= w.start - PRELOAD_AHEAD && p <= w.end + KEEP_BEHIND;
}

/** Scenes whose media may load before any scrolling (the first-paint set). */
export function eagerScenes(): SceneId[] {
  return (Object.keys(SCENE_WINDOW) as SceneId[]).filter((s) => sceneActive(s, 0));
}

/** Max parallax travel for scenery, vh. 0.5 × TRAVEL × speed must stay inside
 *  the stage's 12% overscan for the fastest scenery layer (0.85). */
const TRAVEL = 26;

export interface Frame {
  /** Not on screen (or fully covered) — do not render at all. */
  hidden: boolean;
  x: number; // vw
  y: number; // vh
  scale: number;
  opacity: number;
}

const HIDDEN: Frame = { hidden: true, x: 0, y: 0, scale: 1, opacity: 0 };

/**
 * Scenery parallax inside the plate's scene window, extended half a
 * transition each side so motion never freezes while a wipe is covering.
 */
function sceneryFrame(plate: Plate, p: number): Frame {
  const w = SCENE_WINDOW[plate.scene];
  if (!sceneActive(plate.scene, p)) return HIDDEN;
  const q = span(p, w.start - 0.04, w.end + 0.04);
  return {
    hidden: false,
    x: 0,
    y: (0.5 - q) * TRAVEL * plate.speed,
    scale: 1 + q * 0.05 * (0.4 + plate.speed),
    opacity: 1,
  };
}

/** The persistent sky: barely moves, never unloads. */
function backdropFrame(plate: Plate, p: number): Frame {
  return { hidden: false, x: 0, y: (0.5 - p) * TRAVEL * plate.speed, scale: 1.02, opacity: 1 };
}

/**
 * Transition tracks. Geometry contract with the generation brief:
 *  - t1 cloud   : plate spans 170vw×130vh, its central 70%w × 85%h opaque
 *                 → covers the viewport while |x| ≤ ~9vw; x=0 at t=0.5.
 *  - t2 ridge   : plate spans 130vw×170vh, opaque from 30% height down to
 *                 95% (bottom 5% fades out) → the 110.5vh opaque band covers
 *                 the frame around y=-56vh (t=0.5); fully exited by t=1.
 *  - t3 trunk   : plate spans 150vw×130vh, central 80% width opaque
 *                 → covered while |x| ≤ ~10vw; x=0 at t=0.5.
 *  - t4 arch    : plate covers 130vw×130vh, transparent window ≈ central
 *                 28%w×38%h; window ≥ viewport once scale ≥ 2.75 (t≈0.74).
 *  - t5 curtain : sheer, never fully occludes; the scene crossfades under
 *                 the densest part of the pass (t 0.42–0.58).
 */
function transitionFrame(plate: Plate, p: number): Frame {
  switch (plate.id) {
    case 't1-cloud': {
      if (p < T1.start - PRELOAD_AHEAD || p > T1.end + 0.02) return HIDDEN;
      const t = span(p, T1.start, T1.end);
      return { hidden: p > T1.end, x: lerp(-150, 150, t), y: lerp(6, -6, t), scale: 1, opacity: 1 };
    }
    case 't2-ridge': {
      if (p < T2.start - PRELOAD_AHEAD || p > T2.end + 0.02) return HIDDEN;
      const t = span(p, T2.start, T2.end);
      return { hidden: p > T2.end, x: 0, y: lerp(100, -212, t), scale: 1, opacity: 1 };
    }
    case 't3-trunk': {
      if (p < T3.start - PRELOAD_AHEAD || p > T3.end + 0.02) return HIDDEN;
      const t = span(p, T3.start, T3.end);
      return { hidden: p > T3.end, x: lerp(-160, 160, t), y: 0, scale: 1, opacity: 1 };
    }
    case 't4-arch': {
      if (p < T4.start - PRELOAD_AHEAD || p > T4.end) return HIDDEN;
      const t = span(p, T4.start, T4.end);
      // accelerating approach — quadratic in t but still a pure function of
      // scroll, so backing up replays it exactly
      return { hidden: false, x: 0, y: 0, scale: 1 + 3.2 * t * t, opacity: 1 };
    }
    case 't5-curtain': {
      if (p < T5.start - PRELOAD_AHEAD || p > T5.end + 0.02) return HIDDEN;
      const t = span(p, T5.start, T5.end);
      return { hidden: p > T5.end, x: lerp(140, -140, t), y: 0, scale: 1, opacity: 1 };
    }
    default:
      return HIDDEN;
  }
}

export function plateFrame(plate: Plate, p: number): Frame {
  if (plate.role === 'backdrop') return backdropFrame(plate, p);
  if (plate.role === 'transition') return transitionFrame(plate, p);
  return sceneryFrame(plate, p);
}

/**
 * Opacity of a whole scene's scenery group. Scenes normally swap hidden
 * behind an occluder at the swap point (no fade — binary). The two
 * exceptions: the curtain is sheer, so villa→interior crossfades under it;
 * and every scene fades over ~1.5vh of scroll as a seam-belt in case a
 * plate's opaque core is a few pixels short of spec.
 */
export function sceneOpacity(scene: SceneId, p: number, archMasked = false): number {
  const w = SCENE_WINDOW[scene];
  const FADE = 0.004;
  let o = 1;
  // With the arch-window mask available, the villa scene is visible (masked)
  // through the whole arch approach, not just after the swap.
  const start = scene === 'villa' && archMasked ? T4.start : w.start;
  if (scene !== 'opening') o *= span(p, start - FADE, start + FADE);
  if (scene !== 'interior') o *= 1 - span(p, w.end - FADE, w.end + FADE);
  // villa→interior: soft crossfade under the sheer curtain
  if (scene === 'villa') o *= 1 - span(p, T5.swap - 0.02, T5.swap + 0.02);
  if (scene === 'interior') o = Math.min(o, span(p, T5.swap - 0.02, T5.swap + 0.02));
  return o;
}

/** The warm light leak crossing at the arch transition. */
export function lightLeak(p: number): { opacity: number; x: number } {
  const t = span(p, 0.66, 0.78);
  if (t <= 0 || t >= 1) return { opacity: 0, x: 0 };
  return { opacity: 0.65 * Math.sin(t * Math.PI), x: lerp(-60, 60, t) };
}

/** Hero UI: fully present at the top, gone by 8% scroll. */
export function heroOpacity(p: number): number {
  return 1 - span(p, 0.01, 0.09);
}

/** Closing UI: enters on the interior hold, settled well before the end. */
export function holdOpacity(p: number): number {
  return span(p, 0.88, 0.95);
}

/** Per-scene caption visibility (small kicker lines during the journey). */
export function captionOpacity(scene: SceneId, p: number): number {
  const w = SCENE_WINDOW[scene];
  const mid = (w.start + w.end) / 2;
  const half = (w.end - w.start) / 2;
  return span(p, w.start + half * 0.3, mid - half * 0.2) * (1 - span(p, mid + half * 0.3, w.end - half * 0.1));
}
