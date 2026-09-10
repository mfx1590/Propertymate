'use client';

/**
 * The opening film — a scroll-driven three-shot sequence.
 *
 * Brand intent: the first shot carries the promise and the search box, so
 * nobody has to scroll to use the site. The next two shots earn that promise
 * — beat one names what every property site does, beat two names what this
 * one does instead — and hand off to the verification sequence below, which
 * shows it on a real listing card.
 *
 * Progressive enhancement, exactly like the rest of the page: the server
 * renders a complete static composition (poster stills, h1, search, both
 * beats readable in normal flow). Only after mount, and only when motion is
 * allowed, does the section become 300vh of pinned film.
 *
 * Scroll is the only timeline. Every transform is a pure function of
 * progress, written straight to the DOM from a rAF — React renders the
 * structure once and re-renders only when a shot activates (to attach its
 * media), never per frame.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { landingUrl } from './media';
import s from './landing.module.css';

export interface Shot {
  /** basename in the bucket: `<id>.webm`, `<id>.mp4`, `<id>.webp` */
  id: string;
  /** object-position, for cropping tall viewports sensibly */
  focus?: string;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** local 0→1 progress of p inside [a,b] */
const span = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

/**
 * Act windows. Shot i owns [start, end]; crossfades overlap by FADE.
 *
 * Act one is the short one on purpose: its words are on screen from p=0
 * without any scrolling, so it does not need a third of the film — and an
 * even split left a long stretch after the hero faded with an image and no
 * words on it. The rhythm to protect is words, cut, words, cut, words.
 */
const ACTS = [
  { start: 0.0, end: 0.26 },
  { start: 0.26, end: 0.62 },
  { start: 0.62, end: 1.0 },
];
/**
 * Crossfade width. Deliberately short: a wide dissolve leaves two shots
 * double-exposed for a long stretch of scroll, which reads as mud rather
 * than as a cut. 0.028 of 300vh is about 8vh of travel.
 */
const FADE = 0.028;

function shotOpacity(i: number, p: number): number {
  const a = ACTS[i];
  const inFade = i === 0 ? 1 : span(p, a.start - FADE, a.start + FADE * 0.3);
  const outFade = i === ACTS.length - 1 ? 1 : 1 - span(p, a.end - FADE, a.end + FADE * 0.3);
  return Math.min(inFade, outFade);
}

/**
 * A shot's media is attached a good stretch before it is due, so it is
 * decoded and ready by the time the cut arrives. This is deliberately NOT
 * the same as being played — see `leadShot`. Attaching early costs a
 * download; playing early costs a second video decoding at once.
 */
function shotActive(i: number, p: number): boolean {
  const a = ACTS[i];
  return p >= a.start - 0.16 && p <= a.end + 0.06;
}

/** The shot that currently owns the frame — the only one that should play. */
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

/** Slow push, restarted each act — reads as a camera move, not a zoom. */
function shotScale(i: number, p: number): number {
  return 1.04 + span(p, ACTS[i].start - FADE, ACTS[i].end) * 0.06;
}

/**
 * A partial dip at each cut. A straight dissolve between two very different
 * compositions shows both at half strength — deepening the cut hides the
 * mismatch and reads as a deliberate transition. Kept well short of black:
 * scroll-linked timing means a slow scroller would otherwise sit in the
 * dark wondering what broke.
 */
function dipOpacity(p: number): number {
  let peak = 0;
  for (let i = 0; i < ACTS.length - 1; i++) {
    const t = span(p, ACTS[i].end - FADE, ACTS[i].end + FADE * 0.3);
    if (t > 0 && t < 1) peak = Math.max(peak, Math.sin(t * Math.PI) * 0.55);
  }
  return peak;
}

function beatStyle(i: number, p: number): { opacity: number; y: number } {
  const a = ACTS[i];
  // in after the incoming cut has finished; out before the outgoing cut
  // starts — a line of type must never be caught inside a dissolve.
  const inn = span(p, a.start + 0.02, a.start + 0.1);
  const out = i === ACTS.length - 1 ? 0 : span(p, a.end - 0.12, a.end - FADE - 0.01);
  return { opacity: inn * (1 - out), y: (1 - inn) * 26 - out * 22 };
}

export function ScrollFilm({
  shots,
  topBar,
  hero,
  beats,
  scrollCue,
}: {
  shots: [Shot, Shot, Shot];
  /**
   * Brand mark and nav. Rendered inside the pinned stage so it stays put for
   * the film's whole 300vh rather than scrolling away on the first shot.
   */
  topBar: React.ReactNode;
  /** server-rendered h1 + sub + search form */
  hero: React.ReactNode;
  /** the two typographic beats, server-rendered */
  beats: [React.ReactNode, React.ReactNode];
  scrollCue: string;
}) {
  const [enhanced, setEnhanced] = useState(false);
  const [active, setActive] = useState<boolean[]>([true, false, false]);

  const sectionRef = useRef<HTMLElement>(null);
  const shotEls = useRef<(HTMLDivElement | null)[]>([]);
  const beatEls = useRef<(HTMLDivElement | null)[]>([]);
  const videoEls = useRef<(HTMLVideoElement | null)[]>([]);
  const heroEl = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const cueEl = useRef<HTMLDivElement>(null);
  const dipEl = useRef<HTMLDivElement>(null);
  const dotEls = useRef<(HTMLSpanElement | null)[]>([]);
  const progress = useRef(0);
  const raf = useRef(0);
  const activeKey = useRef('0');
  const leadRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnhanced(!mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const apply = useCallback(() => {
    raf.current = 0;
    const p = progress.current;

    for (let i = 0; i < ACTS.length; i++) {
      const el = shotEls.current[i];
      if (el) {
        const o = shotOpacity(i, p);
        el.style.opacity = String(o);
        el.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
        el.style.transform = `scale(${shotScale(i, p)})`;
      }
      const beat = beatEls.current[i];
      if (beat && i > 0) {
        const b = beatStyle(i, p);
        beat.style.opacity = String(b.opacity);
        beat.style.transform = `translate3d(0, ${b.y}px, 0)`;
      }
      const dot = dotEls.current[i];
      if (dot) {
        const on = p >= ACTS[i].start - FADE && p <= ACTS[i].end;
        dot.style.opacity = on ? '1' : '0.32';
        dot.style.transform = `scaleX(${on ? 1 : 0.4})`;
      }
    }

    if (heroEl.current) {
      // Holds well into act one: this is the h1 and the search box, the most
      // useful thing on the page, so it leaves late and only just before the
      // first cut covers its exit.
      const o = 1 - span(p, 0.1, 0.22);
      heroEl.current.style.opacity = String(o);
      heroEl.current.style.transform = `translate3d(0, ${-span(p, 0.1, 0.26) * 40}px, 0)`;
      heroEl.current.style.pointerEvents = o > 0.5 ? 'auto' : 'none';
    }
    if (cueEl.current) cueEl.current.style.opacity = String(1 - span(p, 0.01, 0.06));
    if (dipEl.current) dipEl.current.style.opacity = String(dipOpacity(p));

    // The release: the film shrinks a touch and rounds off, so the page's
    // paper ground appears at the edges before the pin lets go.
    if (stageEl.current) {
      const r = span(p, 0.94, 1);
      stageEl.current.style.transform = `scale(${1 - r * 0.04})`;
      stageEl.current.style.borderRadius = `${r * 22}px`;
    }

    // Exactly one video decodes: the one that owns the frame. Changed only
    // at handover, never per frame.
    const lead = leadShot(p);
    if (lead !== leadRef.current) {
      leadRef.current = lead;
      videoEls.current.forEach((v, i) => {
        if (!v) return;
        if (i === lead) void v.play().catch(() => undefined);
        else v.pause();
      });
    }

    const nowActive = ACTS.map((_, i) => shotActive(i, p));
    const key = nowActive.map((a) => (a ? 1 : 0)).join('');
    if (key !== activeKey.current) {
      activeKey.current = key;
      setActive(nowActive);
    }
  }, []);

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

  // A shot that has just mounted its sources needs starting if it is already
  // the lead (the play/pause handover itself lives in `apply`).
  useEffect(() => {
    if (!enhanced) return;
    const v = videoEls.current[leadRef.current];
    if (v && v.paused) void v.play().catch(() => undefined);
  }, [active, enhanced]);

  // Dev-only synchronous frame driver: rAF stalls in hidden windows, which
  // makes automated verification flaky. Dead code in production.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__filmApply = (p: number) => {
      progress.current = p;
      apply();
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__filmApply;
    };
  }, [apply]);

  // ---- static path: SSR, no-JS, reduced motion -------------------------
  // The same three shots as posters, the same words, in normal flow.
  if (!enhanced) {
    return (
      <>
        <section className={`${s.film} ${s.filmStatic}`} data-film="static">
          <div className={s.filmStage}>
            {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
            <img
              src={landingUrl(`${shots[0].id}.webp`)}
              alt=""
              className={s.filmShotImg}
              style={{ objectPosition: shots[0].focus }}
              fetchPriority="high"
              decoding="async"
            />
            <div className={s.filmScrim} />
            <div className={s.grain} />
          </div>
          <div className={s.filmTopBar}>{topBar}</div>
          <div className={s.filmHero}>{hero}</div>
        </section>
        {[1, 2].map((i) => (
          <section key={i} className={`${s.film} ${s.filmStaticBeat}`}>
            <div className={s.filmStage}>
              {/* eslint-disable-next-line @next/next/no-img-element -- bucket media */}
              <img
                src={landingUrl(`${shots[i].id}.webp`)}
                alt=""
                className={s.filmShotImg}
                style={{ objectPosition: shots[i].focus }}
                loading="lazy"
                decoding="async"
              />
              <div className={s.filmScrim} />
            </div>
            <div className={s.filmBeatStatic}>{beats[i - 1]}</div>
          </section>
        ))}
      </>
    );
  }

  // ---- enhanced path: the pinned film ----------------------------------
  return (
    <section ref={sectionRef} className={`${s.film} ${s.filmPinned}`} data-film="pinned">
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
                loop
                playsInline
                autoPlay={i === 0}
                preload={i === 0 ? 'auto' : 'none'}
                poster={i === 0 || active[i] ? landingUrl(`${shot.id}.webp`) : undefined}
              >
                {/* H.264 only, deliberately: at matched quality it came out
                    smaller than VP9 for this footage, and one universally
                    supported codec removes a negotiation failure mode. */}
                <source src={landingUrl(`${shot.id}.mp4`)} type="video/mp4" />
              </video>
            </div>
          ))}
          <div className={s.filmScrim} style={{ zIndex: 5 }} />
          <div className={s.grain} style={{ zIndex: 6 }} />
          {/* the dip that deepens each cut */}
          <div ref={dipEl} className={s.filmDip} style={{ opacity: 0 }} />
        </div>

        {/* brand mark + nav: stays for the whole film */}
        <div className={s.filmTopBar}>{topBar}</div>

        {/* act 1: the promise and the search box, available without scrolling */}
        <div ref={heroEl} className={s.filmHero}>
          {hero}
        </div>

        {/* acts 2 and 3: the two beats */}
        {beats.map((beat, k) => (
          <div
            key={k}
            ref={(el) => {
              beatEls.current[k + 1] = el;
            }}
            className={s.filmBeat}
            style={{ opacity: 0 }}
          >
            {beat}
          </div>
        ))}

        {/* film progress: three hairlines, editorial rather than a scrollbar */}
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
