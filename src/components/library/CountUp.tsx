'use client';

import { useEffect, useRef, useState } from 'react';

/** How long a number takes to arrive. Long enough to be seen, short enough to be over. */
const DURATION_MS = 900;

/**
 * A number that rolls up to its value when it first appears.
 *
 * A statistic that is simply there is furniture; one that arrives is a fact
 * being counted, and the eye follows it. The roll is ease-out — fast at first,
 * settling on the last digits — so it reads as a tally ending rather than a
 * slot machine. Readers who asked their system for less motion get the value
 * at once, as do any later changes to it: only the first appearance animates.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(() => (canAnimate() ? 0 : value));
  const animated = useRef(false);

  useEffect(() => {
    if (animated.current || !canAnimate()) {
      setShown(value);
      return;
    }
    animated.current = true;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <b className={className}>{shown}</b>;
}

function canAnimate(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
