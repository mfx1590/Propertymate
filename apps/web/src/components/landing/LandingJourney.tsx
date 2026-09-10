'use client';

/**
 * The scroll journey ("Through the Layers of the Island").
 *
 * Progressive enhancement over a complete server-rendered page: the SSR /
 * no-JS / prefers-reduced-motion rendering is a static poster composition one
 * viewport tall, with the hero (h1, search) fully visible. Only after mount,
 * and only when motion is allowed, does the section grow into the 620vh
 * scroll journey with the seven parallax layers.
 *
 * Animation is imperative: React renders the layer structure once, and a
 * rAF loop driven by scroll events writes transforms straight to the DOM.
 * State changes only at scene-activation boundaries (to attach/detach media)
 * — never per frame.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_MANIFEST,
  loadManifest,
  plateUrl,
  type LandingManifest,
  type Plate,
  type SceneId,
} from './manifest';
import {
  JOURNEY_VH,
  SCENE_WINDOW,
  T4,
  captionOpacity,
  heroOpacity,
  holdOpacity,
  lightLeak,
  plateFrame,
  sceneActive,
  sceneOpacity,
} from './choreography';

/** Base geometry per transition plate — the choreography moves these boxes. */
const TRANSITION_BOX: Record<string, React.CSSProperties> = {
  't1-cloud': { left: '50%', top: '50%', width: '170vw', height: '130vh', margin: '-65vh 0 0 -85vw' },
  't2-ridge': { left: '-15vw', top: 0, width: '130vw', height: '170vh' },
  't3-trunk': { left: '50%', top: '50%', width: '150vw', height: '130vh', margin: '-65vh 0 0 -75vw' },
  't4-arch': { inset: '-15%', transformOrigin: '50% 50%' },
  't5-curtain': { left: '50%', top: '50%', width: '150vw', height: '130vh', margin: '-65vh 0 0 -75vw' },
};

/**
 * One plate: video when the manifest has one (poster underneath), else img.
 *
 * Bandwidth is gated hard: nothing about a plate is fetched — not even the
 * poster, since a `poster` attribute downloads regardless of `preload` —
 * until its scene is eager (first paint) or activated by scroll proximity.
 * `posterOnly` is the static path: always an image, never a video.
 */
function PlateMedia({
  plate,
  active,
  eager,
  posterOnly = false,
}: {
  plate: Plate;
  active: boolean;
  eager: boolean;
  posterOnly?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  // Play once the scene is (nearly) due — play() triggers the fetch that
  // preload="none" withheld; pause when the scene leaves.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [active]);

  const cls = 'absolute inset-0 h-full w-full object-cover';
  if (plate.webm && !videoFailed && !posterOnly) {
    return (
      <video
        ref={videoRef}
        className={cls}
        muted
        loop
        playsInline
        poster={eager || active ? plateUrl(plate.poster) : undefined}
        preload={eager ? 'auto' : 'none'}
        onError={() => setVideoFailed(true)}
      >
        {/* onError on the LAST source: when no source is playable the video
            falls back to its (alpha) poster image. */}
        <source
          src={plateUrl(plate.webm)}
          type="video/webm"
          onError={plate.mp4 ? undefined : () => setVideoFailed(true)}
        />
        {plate.mp4 && (
          <source src={plateUrl(plate.mp4)} type="video/mp4" onError={() => setVideoFailed(true)} />
        )}
      </video>
    );
  }
  if (posterFailed) return null;
  // Activation is the lazy mechanism: a hidden scene's stills stay entirely
  // unmounted (loading="lazy" can't fire inside display:none groups), and
  // mount fetching eagerly once the scroll draws near.
  if (!eager && !active) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- bucket media, decorative
    <img
      src={plateUrl(plate.poster)}
      alt=""
      className={cls}
      decoding="async"
      onError={() => setPosterFailed(true)}
    />
  );
}

/** The always-painted base so a missing plate degrades to a designed sky. */
function SkyGradient() {
  return (
    <div
      className="absolute inset-0"
      style={{
        background:
          'linear-gradient(180deg, #dbeafe 0%, #fde8c8 38%, #f8c98f 55%, #7fb2c9 78%, #476a80 100%)',
      }}
    />
  );
}

interface JourneyProps {
  /** Server-rendered hero: h1, subtitle, search form. */
  hero: React.ReactNode;
  /** Server-rendered closing UI for the interior hold. */
  hold: React.ReactNode;
  /** Translated scene captions, server-side. */
  captions: Partial<Record<SceneId, string>>;
  scrollHint: string;
}

export function LandingJourney({ hero, hold, captions, scrollHint }: JourneyProps) {
  const [manifest, setManifest] = useState<LandingManifest>(DEFAULT_MANIFEST);
  const [enhanced, setEnhanced] = useState(false);
  const [activeScenes, setActiveScenes] = useState<Set<SceneId>>(
    () => new Set<SceneId>(['opening']),
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const plateEls = useRef(new Map<string, HTMLDivElement>());
  const tiltEls = useRef(new Map<string, HTMLDivElement>());
  const groupEls = useRef(new Map<SceneId, HTMLDivElement>());
  const captionEls = useRef(new Map<SceneId, HTMLDivElement>());
  const heroEl = useRef<HTMLDivElement>(null);
  const holdEl = useRef<HTMLDivElement>(null);
  const leakEl = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const tilt = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  const activeKey = useRef('opening');

  // Enhance only when the client allows motion.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnhanced(!mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!enhanced) return;
    let cancelled = false;
    void loadManifest().then((m) => {
      if (!cancelled) setManifest(m);
    });
    return () => {
      cancelled = true;
    };
  }, [enhanced]);

  const plates = useMemo(() => [...manifest.plates].sort((a, b) => a.z - b.z), [manifest]);
  const archMask = useMemo(() => plates.find((p) => p.id === 't4-arch')?.mask, [plates]);
  const scenes = Object.keys(SCENE_WINDOW) as SceneId[];

  /** Write one frame straight to the DOM. */
  const apply = useCallback(() => {
    raf.current = 0;
    const p = progress.current;

    for (const plate of plates) {
      const el = plateEls.current.get(plate.id);
      if (!el) continue;
      const f = plateFrame(plate, p);
      el.style.display = f.hidden ? 'none' : 'block';
      if (f.hidden) continue;
      el.style.opacity = String(f.opacity);
      el.style.transform = `translate3d(${f.x}vw, ${f.y}vh, 0) scale(${f.scale})`;
      const tiltEl = tiltEls.current.get(plate.id);
      if (tiltEl) {
        tiltEl.style.transform = `rotateX(${tilt.current.y * -3}deg) rotateY(${tilt.current.x * 3}deg)`;
      }
    }

    for (const scene of scenes) {
      const group = groupEls.current.get(scene);
      if (group) {
        const o = sceneOpacity(scene, p, scene === 'villa' && Boolean(archMask));
        group.style.opacity = String(o);
        group.style.display = o <= 0 && !sceneActive(scene, p) ? 'none' : 'block';
        // Arch push-through: while the arch flies at the camera, the next
        // scene is visible only through its window — a mask scaled in
        // lockstep with the arch plate.
        if (scene === 'villa' && archMask) {
          if (p >= T4.start && p < T4.swap) {
            const t = (p - T4.start) / (T4.end - T4.start);
            const s = 1 + 3.2 * t * t;
            const url = `url("${plateUrl(archMask)}")`;
            const size = `${130 * s}vw ${130 * s}vh`;
            for (const prefix of ['mask', '-webkit-mask']) {
              group.style.setProperty(`${prefix}-image`, url);
              group.style.setProperty(`${prefix}-size`, size);
              group.style.setProperty(`${prefix}-position`, 'center');
              group.style.setProperty(`${prefix}-repeat`, 'no-repeat');
            }
          } else {
            group.style.removeProperty('mask-image');
            group.style.removeProperty('-webkit-mask-image');
          }
        }
      }
      const caption = captionEls.current.get(scene);
      if (caption) caption.style.opacity = String(captionOpacity(scene, p));
    }

    if (heroEl.current) {
      const o = heroOpacity(p);
      heroEl.current.style.opacity = String(o);
      heroEl.current.style.pointerEvents = o > 0.4 ? 'auto' : 'none';
    }
    if (holdEl.current) {
      const o = holdOpacity(p);
      holdEl.current.style.opacity = String(o);
      holdEl.current.style.pointerEvents = o > 0.4 ? 'auto' : 'none';
    }
    if (leakEl.current) {
      const leak = lightLeak(p);
      leakEl.current.style.opacity = String(leak.opacity);
      leakEl.current.style.transform = `translate3d(${leak.x}vw, 0, 0) rotate(18deg)`;
    }

    // Scene activation is the only state change — and only at boundaries.
    const nowActive = scenes.filter((s) => sceneActive(s, p));
    const key = nowActive.join(',');
    if (key !== activeKey.current) {
      activeKey.current = key;
      setActiveScenes(new Set(nowActive));
    }
  }, [plates, scenes, archMask]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  }, [apply]);

  // Dev-only: drive a frame synchronously (rAF pauses in hidden windows,
  // which makes automated verification flaky). Dead code in production.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as Record<string, unknown>).__landingApply = (p: number) => {
      progress.current = p;
      apply();
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__landingApply;
    };
  }, [apply]);

  useEffect(() => {
    if (!enhanced) return;
    const onScroll = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      progress.current = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
      schedule();
    };
    const onPointer = (e: PointerEvent) => {
      // ±1 across the viewport; the concept's ±3° is applied in `apply`.
      tilt.current = {
        x: (e.clientX / window.innerWidth) * 2 - 1,
        y: (e.clientY / window.innerHeight) * 2 - 1,
      };
      schedule();
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('pointermove', onPointer, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pointermove', onPointer);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [enhanced, schedule]);

  // ---- static path: SSR, no-JS, and prefers-reduced-motion ---------------
  // A one-viewport poster composition of the Kyrenia coast, hero on top.
  if (!enhanced) {
    const postcard = ['l0-sky', 's1-sea', 's1-ridge-haze', 's1-harbour'];
    return (
      <section className="relative h-screen min-h-[560px] overflow-hidden" data-landing="static">
        <div className="absolute inset-0" aria-hidden dir="ltr">
          <SkyGradient />
          {plates
            .filter((pl) => postcard.includes(pl.id))
            .map((pl) => (
              <div key={pl.id} className="absolute inset-0">
                <PlateMedia plate={pl} active={false} eager posterOnly />
              </div>
            ))}
          <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/30" />
        </div>
        <div className="relative z-10 flex h-full items-center justify-center px-4">{hero}</div>
      </section>
    );
  }

  // ---- enhanced path: the journey ----------------------------------------
  return (
    <section
      ref={containerRef}
      className="relative"
      style={{ height: `${JOURNEY_VH}vh` }}
      data-landing="journey"
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        <div className="absolute inset-0" aria-hidden dir="ltr">
          <SkyGradient />
          {/* backdrop plates (the sky) sit under every scene group */}
          {plates
            .filter((pl) => pl.role === 'backdrop')
            .map((pl) => (
              <div
                key={pl.id}
                ref={(el) => {
                  if (el) plateEls.current.set(pl.id, el);
                  else plateEls.current.delete(pl.id);
                }}
                className="absolute inset-[-12%] will-change-transform"
                style={{ zIndex: pl.z }}
              >
                <PlateMedia plate={pl} active={activeScenes.has(pl.scene)} eager />
              </div>
            ))}

          {/* one group per scene so a whole scene can swap/fade as one */}
          {scenes.map((scene) => (
            <div
              key={scene}
              ref={(el) => {
                if (el) groupEls.current.set(scene, el);
                else groupEls.current.delete(scene);
              }}
              className="absolute inset-0"
              style={{ zIndex: 10, opacity: scene === 'opening' ? 1 : 0 }}
            >
              {plates
                .filter((pl) => pl.scene === scene && pl.role === 'scenery')
                .map((pl) => (
                  <div
                    key={pl.id}
                    ref={(el) => {
                      if (el) plateEls.current.set(pl.id, el);
                      else plateEls.current.delete(pl.id);
                    }}
                    className="absolute inset-[-12%] will-change-transform"
                    style={{ zIndex: pl.z, display: scene === 'opening' ? 'block' : 'none' }}
                  >
                    {pl.tilt ? (
                      <div
                        ref={(el) => {
                          if (el) tiltEls.current.set(pl.id, el);
                          else tiltEls.current.delete(pl.id);
                        }}
                        className="absolute inset-0 transition-transform duration-200 ease-out"
                        style={{ transformStyle: 'preserve-3d' }}
                      >
                        <PlateMedia plate={pl} active={activeScenes.has(scene)} eager={scene === 'opening'} />
                      </div>
                    ) : (
                      <PlateMedia plate={pl} active={activeScenes.has(scene)} eager={scene === 'opening'} />
                    )}
                  </div>
                ))}
            </div>
          ))}

          {/* transition plates fly above every scene group */}
          {plates
            .filter((pl) => pl.role === 'transition')
            .map((pl) => (
              <div
                key={pl.id}
                ref={(el) => {
                  if (el) plateEls.current.set(pl.id, el);
                  else plateEls.current.delete(pl.id);
                }}
                className="absolute will-change-transform"
                style={{ zIndex: pl.z, display: 'none', ...TRANSITION_BOX[pl.id] }}
              >
                <PlateMedia plate={pl} active={activeScenes.has(pl.scene)} eager={pl.scene === 'opening'} />
              </div>
            ))}

          {/* the single warm light leak at the arch transition */}
          <div
            ref={leakEl}
            className="pointer-events-none absolute inset-[-30%] mix-blend-screen"
            style={{
              zIndex: 70,
              opacity: 0,
              background:
                'radial-gradient(ellipse 40% 90% at 50% 50%, rgba(255,190,120,0.9) 0%, rgba(255,150,80,0.35) 45%, transparent 70%)',
            }}
          />
        </div>

        {/* scene captions */}
        {scenes.map((scene) => {
          const text = captions[scene];
          if (!text) return null;
          return (
            <div
              key={scene}
              ref={(el) => {
                if (el) captionEls.current.set(scene, el);
                else captionEls.current.delete(scene);
              }}
              className="pointer-events-none absolute bottom-14 start-6 z-[80] max-w-xs sm:start-12"
              style={{ opacity: 0 }}
            >
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-white/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.5)]">
                {text}
              </p>
            </div>
          );
        })}

        {/* hero UI — present in the HTML from the server, fades on scroll */}
        <div ref={heroEl} className="absolute inset-0 z-[90] flex items-center justify-center px-4">
          <div className="w-full">
            {hero}
            <p className="mt-10 animate-bounce text-center text-sm text-white/90 [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]">
              ↓ {scrollHint}
            </p>
          </div>
        </div>

        {/* closing UI on the interior hold */}
        <div
          ref={holdEl}
          className="absolute inset-0 z-[90] flex items-end justify-center pb-24"
          style={{ opacity: 0, pointerEvents: 'none' }}
        >
          {hold}
        </div>
      </div>
    </section>
  );
}
