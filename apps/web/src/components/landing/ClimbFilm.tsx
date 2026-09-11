'use client';

/**
 * "The Climb" — the homepage hook. See STORY.md for the treatment.
 *
 * Five keyframe-chained shots on the PropVerify monument: our man climbs the
 * steep roof slab while the questions every buyer faces crowd in around him;
 * at the apex each one flips to the check we actually perform and dissolves;
 * the far side is the P's curve — easy — and it delivers him into the lit
 * room inside the logo. The final frame IS the brand mark.
 *
 * Two things are deliberately not in the video:
 *  - the words — h1, the questions, the checks and the closing line are live
 *    HTML: localised in four languages, real text for search engines and
 *    screen readers, crisp at every resolution, and they can flip and
 *    dissolve on scroll because they are DOM, not pixels;
 *  - the timeline — scroll is the only clock. On a fine pointer the shots
 *    are scrubbed (currentTime follows the scroll, so the climb literally
 *    happens under the reader's hand); on touch they play through their act,
 *    which is smoother on phones than seeking.
 *
 * Progressive enhancement, like everything on this page: the server renders
 * the poster of the climb with the h1 and the search box, the five checks as
 * a plain list, and the poster of home with the brand line. Only after mount,
 * with motion allowed, does it become the pinned film.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { landingUrl } from './media';
import s from './landing.module.css';

export interface ClimbQuestion {
  key: string;
  question: string;
  answer: string;
}

export interface ClimbShot {
  /** basename in the bucket: `<id>.mp4` + `<id>.webp` */
  id: string;
  /** object-position; matters on phones, where the portrait crop keeps only
   *  the middle ~26% of the width and must be aimed at the climber */
  focus: string;
  /** seconds; used to map act-local progress to currentTime when scrubbing */
  seconds: number;
}

/**
 * pause() on a video that has never started loading is not a no-op: per the
 * HTML spec it runs resource selection, i.e. it fetches the file. Every
 * "pause the others" must skip the ones that were never asked for.
 */
const safePause = (v: HTMLVideoElement) => {
  if (v.networkState !== HTMLMediaElement.NETWORK_EMPTY) v.pause();
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The five acts. One shot each; shot i is scrubbed across act i, so shot n
 * ends on the frame shot n+1 starts on (they were generated that way) and
 * the FADE below only has to hide generation drift, not a cut.
 */
const ACTS = [
  { start: 0.0, end: 0.1 }, // establish — at the foot, looking up
  { start: 0.1, end: 0.42 }, // the climb — the questions crowd in
  { start: 0.42, end: 0.58 }, // the ridge — each one flips to a check
  { start: 0.58, end: 0.8 }, // the easy way — down the P's curve
  { start: 0.8, end: 1.0 }, // home — inside the logo
];
const FADE = 0.018;

/**
 * Where the climber is in the frame, as a fraction of the stage, per act
 * boundary. The question widgets orbit this point, so they rise with him.
 * Read off the keyframes; the camera holds the monument in place.
 */
const ANCHOR: [number, number][] = [
  [0.12, 0.8], // K0 foot
  [0.36, 0.46], // K1 a third up
  [0.48, 0.36], // K2 two thirds up
  [0.52, 0.1], // K3 apex
  [0.53, 0.35], // K4 on the curve
  [0.5, 0.52], // K5 home
];

/** Widgets never enter the top bar's band or leave the stage (y as a
 *  fraction of the stage; x is clamped by the chip's own width). */
const WIDGET_Y = { min: 0.16, max: 0.9 };

const VIDEO_ASPECT = 16 / 9;

/** '22% 50%' → [0.22, 0.5] */
function parseFocus(focus: string): [number, number] {
  const m = focus.match(/([\d.]+)%\s+([\d.]+)%/);
  return m ? [Number(m[1]) / 100, Number(m[2]) / 100] : [0.5, 0.5];
}

/**
 * Raw-frame fraction → stage pixels, through `object-fit: cover` and the
 * shot's object-position. On a phone the portrait stage shows only the
 * middle ~26% of the frame's width, aimed by the focus, so the climber's
 * screen position is nothing like his raw position; the widgets must follow
 * the crop or they tether to empty air.
 */
function rawToStage(rx: number, ry: number, W: number, H: number, focus: [number, number]): [number, number] {
  if (W / H < VIDEO_ASPECT) {
    const vw = H * VIDEO_ASPECT;
    const left = -(vw - W) * focus[0];
    return [rx * vw + left, ry * H];
  }
  const vh = W / VIDEO_ASPECT;
  const top = -(vh - H) * focus[1];
  return [rx * W, ry * vh + top];
}

function anchorAt(p: number): [number, number] {
  for (let i = 0; i < ACTS.length; i++) {
    const a = ACTS[i];
    if (p <= a.end || i === ACTS.length - 1) {
      const t = span(p, a.start, a.end);
      return [lerp(ANCHOR[i][0], ANCHOR[i + 1][0], t), lerp(ANCHOR[i][1], ANCHOR[i + 1][1], t)];
    }
  }
  return ANCHOR[ANCHOR.length - 1];
}

/** Offsets from the anchor for the five widgets, in fractions of the stage:
 *  a loose arc on the uphill side, the way the questions come at him. */
const ORBIT: [number, number][] = [
  [-0.21, 0.01],
  [-0.13, -0.13],
  [0.02, -0.16],
  [0.2, -0.04],
  [-0.2, 0.09],
];

function shotOpacity(i: number, p: number): number {
  const a = ACTS[i];
  const inn = i === 0 ? 1 : span(p, a.start - FADE, a.start + FADE * 0.3);
  const out = i === ACTS.length - 1 ? 1 : 1 - span(p, a.end - FADE, a.end + FADE * 0.3);
  return Math.min(inn, out);
}

/**
 * Media attaches a little before its act. The lead is short on purpose: at
 * ~1 MB a shot, a generous lead would pull the second shot into first paint
 * before the reader has scrolled at all. 0.06 of 460vh is ~28vh of travel,
 * plenty at scroll speed for a faststart MP4 on a normal connection.
 */
function shotActive(i: number, p: number): boolean {
  const a = ACTS[i];
  return p >= a.start - (i === 0 ? 1 : 0.06) && p <= a.end + 0.05;
}

function leadShot(p: number): number {
  let best = 0;
  let bestO = -1;
  for (let i = 0; i < ACTS.length; i++) {
    const o = shotOpacity(i, p);
    if (o > bestO) {
      bestO = o;
      best = i;
    }
  }
  return best;
}

/** Question widget i: when it surfaces, when it flips, when it dissolves. */
function widgetState(i: number, p: number): { opacity: number; flipped: boolean; scale: number; y: number } {
  const enter = 0.13 + i * 0.05;
  const flip = 0.46 + i * 0.02;
  const gone = 0.535 + i * 0.011;
  const inn = span(p, enter, enter + 0.035);
  const out = span(p, gone, gone + 0.03);
  const flipped = p >= flip;
  return {
    opacity: inn * (1 - out),
    flipped,
    scale: lerp(0.86, 1, inn) * lerp(1, 1.08, out),
    y: (1 - inn) * 14 - out * 18,
  };
}

function fadeWindow(p: number, a: number, b: number, c: number, d: number): number {
  return span(p, a, b) * (1 - span(p, c, d));
}

export function ClimbFilm({
  shots,
  topBar,
  hero,
  questions,
  ridgeLine,
  descentLine,
  closing,
  scrollCue,
}: {
  shots: [ClimbShot, ClimbShot, ClimbShot, ClimbShot, ClimbShot];
  topBar: React.ReactNode;
  /** h1 + sub + search — on screen from the first frame */
  hero: React.ReactNode;
  questions: ClimbQuestion[];
  ridgeLine: string;
  descentLine: string;
  /** brand line + search again — the last frame */
  closing: React.ReactNode;
  scrollCue: string;
}) {
  const [enhanced, setEnhanced] = useState(false);
  const [scrub, setScrub] = useState(false);
  /**
   * Two encodes per shot. Wide stages get the 1080p `-hd` file (Topaz-
   * upscaled source, low CRF): on a 1440-wide or retina screen the 720p
   * encode reads soft, and a soft hero is the one thing a brand film can't
   * be. Phones keep 720p — a quarter of the frame is on screen at a time and
   * the bytes matter more than the pixels.
   */
  const [hd, setHd] = useState(false);
  const [active, setActive] = useState<boolean[]>([true, false, false, false, false]);

  const sectionRef = useRef<HTMLElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const shotEls = useRef<(HTMLDivElement | null)[]>([]);
  const videoEls = useRef<(HTMLVideoElement | null)[]>([]);
  const widgetEls = useRef<(HTMLDivElement | null)[]>([]);
  const lineEls = useRef<(SVGLineElement | null)[]>([]);
  const heroEl = useRef<HTMLDivElement>(null);
  const ridgeEl = useRef<HTMLDivElement>(null);
  const descentEl = useRef<HTMLDivElement>(null);
  const closingEl = useRef<HTMLDivElement>(null);
  const cueEl = useRef<HTMLDivElement>(null);
  const dotEls = useRef<(HTMLSpanElement | null)[]>([]);
  const progress = useRef(0);
  const raf = useRef(0);
  const activeKey = useRef('10000');
  const leadRef = useRef(0);
  const flippedRef = useRef<boolean[]>(questions.map(() => false));
  // shot 0 is preload="auto" from the markup — never load() it again
  const loadedRef = useRef<boolean[]>(shots.map((_, i) => i === 0));

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(pointer: fine)');
    const update = () => {
      setEnhanced(!motion.matches);
      setScrub(fine.matches);
      setHd(window.innerWidth >= 1024);
    };
    update();
    motion.addEventListener('change', update);
    fine.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      fine.removeEventListener('change', update);
    };
  }, []);

  /** Seek a shot to act-local progress. Guarded on metadata being there. */
  const seek = useCallback((i: number, local: number) => {
    const v = videoEls.current[i];
    if (!v || v.readyState < 1) return;
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : shots[i].seconds;
    const t = clamp01(local) * Math.max(0, dur - 0.05);
    // a frame's worth of tolerance keeps the seek queue from thrashing
    if (Math.abs(v.currentTime - t) > 1 / 30) v.currentTime = t;
  }, [shots]);

  const apply = useCallback(() => {
    raf.current = 0;
    const p = progress.current;
    const stage = stageEl.current;
    const W = stage?.clientWidth ?? 1;
    const H = stage?.clientHeight ?? 1;

    for (let i = 0; i < ACTS.length; i++) {
      const el = shotEls.current[i];
      if (el) {
        const o = shotOpacity(i, p);
        el.style.opacity = String(o);
        el.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
      }
      const dot = dotEls.current[i];
      if (dot) {
        const on = p >= ACTS[i].start - FADE && p <= ACTS[i].end;
        dot.style.opacity = on ? '1' : '0.32';
        dot.style.transform = `scaleX(${on ? 1 : 0.4})`;
      }
    }

    // The clock: scrub the shot that owns the frame (and keep its neighbours
    // parked on their first/last frame so the handover is seamless).
    const lead = leadShot(p);
    if (scrub) {
      for (let i = 0; i < ACTS.length; i++) {
        if (!shotActive(i, p)) continue;
        const local = span(p, ACTS[i].start, ACTS[i].end);
        seek(i, local);
      }
    } else if (lead !== leadRef.current) {
      videoEls.current.forEach((v, i) => {
        if (!v) return;
        if (i === lead) void v.play().catch(() => undefined);
        else safePause(v);
      });
    }
    leadRef.current = lead;

    // The questions: orbit the climber, flip at the ridge, dissolve.
    const [ax, ay] = anchorAt(p);
    const focus = parseFocus(shots[lead].focus);
    const [AX, AY] = rawToStage(ax, ay, W, H, focus);
    // a phone stage is a quarter of the frame wide: tighten the orbit or the
    // chips all clamp to the same edge and pile up
    const orbitScale = W < 768 ? 0.6 : 1;
    questions.forEach((_, i) => {
      const el = widgetEls.current[i];
      if (!el) return;
      const st = widgetState(i, p);
      const drift = Math.sin(p * 38 + i * 1.7) * 4;
      const [ox, oy] = rawToStage(
        ax + ORBIT[i % ORBIT.length][0] * orbitScale,
        ay + ORBIT[i % ORBIT.length][1] * orbitScale,
        W,
        H,
        focus,
      );
      const half = el.offsetWidth / 2 + 8;
      const cx = Math.min(W - half, Math.max(half, ox));
      const cy = Math.min(WIDGET_Y.max * H, Math.max(WIDGET_Y.min * H, oy)) + st.y + drift;
      el.style.opacity = String(st.opacity);
      el.style.transform = `translate(-50%, -50%) translate3d(${cx}px, ${cy}px, 0) scale(${st.scale})`;
      el.style.visibility = st.opacity <= 0.001 ? 'hidden' : 'visible';
      if (st.flipped !== flippedRef.current[i]) {
        flippedRef.current[i] = st.flipped;
        el.dataset.flipped = st.flipped ? 'true' : 'false';
      }
      const line = lineEls.current[i];
      if (line) {
        line.setAttribute('x1', String(cx));
        line.setAttribute('y1', String(cy));
        line.setAttribute('x2', String(AX));
        line.setAttribute('y2', String(AY));
        line.style.opacity = String(st.opacity * (st.flipped ? 0.25 : 0.55));
      }
    });

    if (heroEl.current) {
      const o = 1 - span(p, 0.06, 0.15);
      heroEl.current.style.opacity = String(o);
      heroEl.current.style.transform = `translate3d(0, ${-span(p, 0.06, 0.18) * 36}px, 0)`;
      heroEl.current.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
    }
    if (ridgeEl.current) {
      const o = fadeWindow(p, 0.5, 0.555, 0.6, 0.64);
      ridgeEl.current.style.opacity = String(o);
      ridgeEl.current.style.transform = `translate3d(0, ${(1 - span(p, 0.5, 0.555)) * 22}px, 0)`;
    }
    if (descentEl.current) {
      const o = fadeWindow(p, 0.63, 0.69, 0.78, 0.82);
      descentEl.current.style.opacity = String(o);
      descentEl.current.style.transform = `translate3d(0, ${(1 - span(p, 0.63, 0.69)) * 22}px, 0)`;
    }
    if (closingEl.current) {
      const o = span(p, 0.86, 0.93);
      closingEl.current.style.opacity = String(o);
      closingEl.current.style.transform = `translate3d(0, ${(1 - o) * 26}px, 0)`;
      closingEl.current.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
    }
    if (cueEl.current) cueEl.current.style.opacity = String(1 - span(p, 0.01, 0.05));

    const nowActive = ACTS.map((_, i) => shotActive(i, p));
    const key = nowActive.map((a) => (a ? 1 : 0)).join('');
    if (key !== activeKey.current) {
      activeKey.current = key;
      setActive(nowActive);
    }
  }, [questions, scrub, seek, shots]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  }, [apply]);

  useEffect(() => {
    if (!enhanced) return;
    const onScroll = () => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      progress.current = total > 0 ? clamp01(-rect.top / total) : 0;
      schedule();
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [enhanced, schedule]);

  // A shot that just became active needs its bytes: in scrub mode that means
  // a real load() (preload="none" withheld it) so seeking has frames to land
  // on; in play mode the lead starts on its own.
  useEffect(() => {
    if (!enhanced) return;
    videoEls.current.forEach((v, i) => {
      if (!v || !active[i] || loadedRef.current[i]) return;
      loadedRef.current[i] = true;
      v.preload = 'auto';
      v.load();
      const onMeta = () => {
        if (scrub) {
          seek(i, span(progress.current, ACTS[i].start, ACTS[i].end));
        } else if (i === leadRef.current) {
          void v.play().catch(() => undefined);
        }
      };
      v.addEventListener('loadedmetadata', onMeta, { once: true });
    });
    // Mode switch: scrubbing parks every shot on its scroll frame; play-through
    // needs the lead running — including shot 0 at the very top, which no
    // handover ever starts because it is the lead from the first frame.
    if (scrub) {
      videoEls.current.forEach((v) => v && safePause(v));
    } else {
      const v = videoEls.current[leadRef.current];
      if (v && v.paused) void v.play().catch(() => undefined);
    }
  }, [active, enhanced, scrub, seek]);

  // Dev-only synchronous frame driver (rAF stalls in hidden windows, which
  // makes automated verification flaky). Dead code in production.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as unknown as Record<string, unknown>;
    w.__climbApply = (p: number) => {
      progress.current = p;
      apply();
    };
    // headless Chrome cannot emulate a coarse pointer; this lets the touch
    // path (play-through instead of scrub) be exercised in verification
    w.__climbSetScrub = (v: boolean) => setScrub(v);
    return () => {
      delete w.__climbApply;
      delete w.__climbSetScrub;
    };
  }, [apply]);

  // ---- static path: SSR, no-JS, reduced motion -------------------------
  if (!enhanced) {
    return (
      <>
        <section className={`${s.film} ${s.filmStatic}`} data-climb="static">
          <div className={s.filmStage}>
            {/* the first shot's poster — the same file the enhanced path
                shows, so hydration does not swap the picture */}
            {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
            <img
              src={landingUrl(`${shots[0].id}.webp`)}
              alt=""
              className={s.filmShotImg}
              style={{ objectPosition: shots[0].focus }}
              fetchPriority="high"
              decoding="async"
            />
            <div className={s.climbScrim} />
            <div className={s.grain} />
          </div>
          <div className={s.filmTopBar}>{topBar}</div>
          <div className={s.climbHero}>{hero}</div>
        </section>
        <section className={s.climbStaticChecks}>
          <p className={`${s.serif} ${s.climbStaticLine}`}>{ridgeLine}</p>
          <ul className={s.climbStaticList}>
            {questions.map((q) => (
              <li key={q.key}>
                <span className={s.climbStaticQ}>{q.question}</span>
                <span className={s.climbStaticA}>
                  <Tick />
                  {q.answer}
                </span>
              </li>
            ))}
          </ul>
          <p className={`${s.serif} ${s.climbStaticLine}`}>{descentLine}</p>
        </section>
        <section className={`${s.film} ${s.filmStaticBeat}`}>
          <div className={s.filmStage}>
            {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
            <img
              src={landingUrl(`${shots[4].id}.webp`)}
              alt=""
              className={s.filmShotImg}
              style={{ objectPosition: shots[4].focus }}
              loading="lazy"
              decoding="async"
            />
            <div className={s.climbScrim} />
          </div>
          <div className={s.climbClosingStatic}>{closing}</div>
        </section>
      </>
    );
  }

  // ---- enhanced path: the pinned film ----------------------------------
  return (
    <section ref={sectionRef} className={`${s.film} ${s.climbPinned}`} data-climb="pinned">
      <div className={s.filmSticky}>
        <div ref={stageEl} className={s.filmStage}>
          {shots.map((shot, i) => (
            <div
              key={shot.id}
              ref={(el) => {
                shotEls.current[i] = el;
              }}
              className={s.filmShot}
              style={{ opacity: i === 0 ? 1 : 0, zIndex: i }}
            >
              <video
                ref={(el) => {
                  videoEls.current[i] = el;
                }}
                className={s.filmShotImg}
                style={{ objectPosition: shot.focus }}
                muted
                playsInline
                loop={!scrub}
                preload={i === 0 ? 'auto' : 'none'}
                poster={i === 0 || active[i] ? landingUrl(`${shot.id}.webp`) : undefined}
              >
                <source src={landingUrl(`${shot.id}${hd ? '-hd' : ''}.mp4`)} type="video/mp4" />
              </video>
            </div>
          ))}
          <div className={s.climbScrim} style={{ zIndex: 6 }} />
          <div className={s.grain} style={{ zIndex: 7 }} />

          {/* tethers from each question to the climber, in stage pixels */}
          <svg className={s.climbLines} aria-hidden>
            {questions.map((q, i) => (
              <line
                key={q.key}
                ref={(el) => {
                  lineEls.current[i] = el;
                }}
                x1="0"
                y1="0"
                x2="0"
                y2="0"
                style={{ opacity: 0 }}
              />
            ))}
          </svg>

          {/* the questions — live HTML, not pixels */}
          {questions.map((q, i) => (
            <div
              key={q.key}
              ref={(el) => {
                widgetEls.current[i] = el;
              }}
              className={s.climbWidget}
              data-flipped="false"
              style={{ opacity: 0, visibility: 'hidden' }}
              aria-hidden
            >
              <span className={s.climbWidgetQ}>
                <i className={s.climbWidgetDot} />
                {q.question}
              </span>
              <span className={s.climbWidgetA}>
                <Tick />
                {q.answer}
              </span>
            </div>
          ))}
        </div>

        <div className={s.filmTopBar}>{topBar}</div>

        <div ref={heroEl} className={s.climbHero}>
          {hero}
        </div>

        <div ref={ridgeEl} className={s.climbLine} style={{ opacity: 0 }}>
          <p className={`${s.serif} ${s.beatTextSmall}`}>{ridgeLine}</p>
        </div>
        <div ref={descentEl} className={s.climbLine} style={{ opacity: 0 }}>
          <p className={`${s.serif} ${s.beatText}`}>{descentLine}</p>
        </div>

        <div ref={closingEl} className={s.climbClosing} style={{ opacity: 0, pointerEvents: 'none' }}>
          {closing}
        </div>

        <div className={s.filmRail} aria-hidden>
          {ACTS.map((_, i) => (
            <span
              key={i}
              ref={(el) => {
                dotEls.current[i] = el;
              }}
              style={{ opacity: i === 0 ? 1 : 0.32 }}
            />
          ))}
        </div>

        <div ref={cueEl} className={s.filmCue} aria-hidden>
          <span>{scrollCue}</span>
          <i />
        </div>
      </div>
    </section>
  );
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M2 6.2 5 9l5-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
