'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import s from './landing.module.css';

interface Stage {
  question: string;
  answerTitle: string;
  answerBody: string;
  checkLabel: string;
  /** small detail chip shown on the card row (e.g. a deed type) */
  chip?: string;
}

/**
 * The pinned "what we check" sequence. Desktop with motion: the section is
 * 280vh tall, the panel sticks, and scroll lights the three checks one by
 * one on a listing card until the VERIFIED stamp lands. Mobile, no-JS and
 * reduced-motion: the same content, fully lit, in normal flow — the server
 * HTML is that complete version.
 */
export function VerifySequence({
  eyebrow,
  title,
  body,
  stages,
  stamp,
  thumbSrc,
}: {
  eyebrow: string;
  title: string;
  body: string;
  stages: Stage[];
  stamp: string;
  thumbSrc: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [stage, setStage] = useState(3); // 3 = everything lit (static default)
  const [thumbOk, setThumbOk] = useState(true);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wide = window.matchMedia('(min-width: 1024px)');
    const update = () => {
      const on = !motion.matches && wide.matches;
      setEnhanced(on);
      if (!on) setStage(3);
    };
    update();
    motion.addEventListener('change', update);
    wide.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      wide.removeEventListener('change', update);
    };
  }, []);

  const onScroll = useCallback(() => {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
    // three checks across the first 85% of the pin, stamp in the last 15%
    const next = p >= 0.88 ? 3 : Math.min(2, Math.floor(p * 3.3));
    setStage((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (!enhanced) return;
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [enhanced, onScroll]);

  const lit = (i: number) => !enhanced || stage >= i;
  const focused = (i: number) => !enhanced || stage === i || (stage >= 3 && i === stages.length - 1);

  return (
    <section ref={sectionRef} style={enhanced ? { height: '280vh' } : undefined}>
      <div
        className={enhanced ? 'sticky top-0 flex min-h-screen items-center' : undefined}
        style={enhanced ? { overflow: 'hidden' } : undefined}
      >
        <div className="mx-auto grid w-full max-w-6xl gap-14 px-5 py-24 lg:grid-cols-2 lg:items-center lg:gap-20">
          {/* copy column */}
          <div>
            <p className={s.kicker}>{eyebrow}</p>
            <h2 className={`${s.serif} mt-4 text-3xl font-semibold leading-tight sm:text-4xl`}>
              {title}
            </h2>
            <p className="mt-5 max-w-xl leading-relaxed" style={{ color: 'var(--muted-on-paper)' }}>
              {body}
            </p>
            <div className="mt-10 space-y-8">
              {stages.map((st, i) => (
                <div key={i} className={focused(i) ? s.stageLit : s.stageDim}>
                  <p className="text-sm font-medium" style={{ color: 'var(--muted-on-paper)' }}>
                    {st.question}
                  </p>
                  <p className={`${s.serif} mt-1.5 text-xl font-semibold`} style={{ color: 'var(--teal)' }}>
                    {st.answerTitle}
                  </p>
                  <p className="mt-1.5 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--muted-on-paper)' }}>
                    {st.answerBody}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* the listing card being verified */}
          <div className="relative mx-auto w-full max-w-md">
            <div className={`${s.docCard} relative rounded-3xl p-5`}>
              <div
                className="relative overflow-hidden rounded-2xl"
                style={{ aspectRatio: '3 / 2', background: 'linear-gradient(160deg, #14424a, #0b2229)' }}
              >
                {thumbOk && (
                  // eslint-disable-next-line @next/next/no-img-element -- bucket media, decorative
                  <img
                    src={thumbSrc}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={() => setThumbOk(false)}
                  />
                )}
              </div>
              {/* skeleton title lines — a listing, not any particular listing */}
              <div className="mt-5 space-y-2.5" aria-hidden>
                <div className="h-3.5 w-2/3 rounded-full" style={{ background: 'rgba(24,43,47,0.16)' }} />
                <div className="h-3 w-2/5 rounded-full" style={{ background: 'rgba(24,43,47,0.09)' }} />
              </div>

              <div className="mt-6 space-y-3.5">
                {stages.map((st, i) => (
                  <div
                    key={i}
                    className={`${s.checkRow} ${lit(i) ? '' : s.checkRowOff} flex items-center gap-3`}
                  >
                    <span className={s.tick}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M2 6.2 5 9l5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-sm font-medium">{st.checkLabel}</span>
                    {st.chip && (
                      <span
                        className="ms-auto rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{ background: 'rgba(217,162,95,0.16)', color: '#8a5a1f' }}
                      >
                        {st.chip}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="pointer-events-none absolute -end-3 -top-3">
                <span className={`${s.stamp} ${s.serif} ${!enhanced || stage >= 3 ? '' : s.stampOff} inline-block bg-[#fffdf8]`}>
                  {stamp}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
