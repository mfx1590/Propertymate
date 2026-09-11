'use client';

import { useEffect, useRef, useState } from 'react';
import s from './landing.module.css';

/**
 * Reveal-on-scroll wrapper. Server-rendered fully visible (SEO, no-JS); on
 * mount, elements still below the fold are hidden and revealed when they
 * enter the viewport. Content already on screen — and every reduced-motion
 * reader — never sees the animation at all.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'ssr' | 'hidden' | 'shown'>('ssr');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setPhase('hidden');
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPhase('shown');
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={[
        className,
        phase === 'hidden' ? s.revealHidden : '',
        phase === 'shown' ? s.revealShown : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
