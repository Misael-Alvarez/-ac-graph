'use client';

import { useCallback, useEffect, useState, type AnimationEvent } from 'react';

/**
 * Keeps something on screen long enough to leave.
 *
 * React unmounts on the same frame the state says "closed", so a dialog or a
 * menu vanished with no exit while it had arrived with one. `usePresence`
 * hands back the last open value while `closing`, so the component can wear
 * `data-closing` and play its exit keyframes, and unmounts when the animation
 * says it ended — or, if nothing animates (reduced motion, a hidden tab), after
 * a short fallback. Reopening during the exit simply cancels it.
 */
export interface Presence<T> {
  /** What to render: the current value while open, the previous one while closing, null when gone. */
  shown: T | null;
  closing: boolean;
  /** Call when the exit animation ended; `exitProps` wires it for you. */
  onExited: () => void;
  /**
   * Changes on every opening. Use it as the React `key` of the contents, so a
   * dialog reopened while its predecessor is still leaving starts afresh
   * instead of inheriting its state.
   */
  key: number;
}

/** Slightly longer than the longest exit in the stylesheet, so it never cuts one short. */
export const EXIT_FALLBACK_MS = 260;

export function usePresence<T>(
  value: T | null | undefined | false,
  fallbackMs = EXIT_FALLBACK_MS,
): Presence<T> {
  const open = value ? value : null;
  // The value seen last render, and the one currently on its way out. Adjusted
  // during render — the documented way to derive state from a changed input —
  // rather than in an effect, which would paint one frame without the exit.
  const [previous, setPrevious] = useState<T | null>(open);
  const [exiting, setExiting] = useState<T | null>(null);
  const [key, setKey] = useState(0);
  if (open !== previous) {
    setPrevious(open);
    setExiting(open ? null : previous);
    if (open && !previous) setKey((k) => k + 1);
  }

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(null), fallbackMs);
    return () => clearTimeout(timer);
  }, [exiting, fallbackMs]);

  const onExited = useCallback(() => setExiting(null), []);

  return { shown: open ?? exiting, closing: !open && exiting !== null, onExited, key };
}

/**
 * The attributes an exiting element wears: `data-closing` for the stylesheet,
 * and the listener that unmounts it once an `*-out` animation has finished.
 * Entrance animations and children's own animations end here too; only the
 * exit counts.
 */
export function exitProps(closing: boolean, onExited: () => void) {
  return {
    'data-closing': closing ? '' : undefined,
    onAnimationEnd: (event: AnimationEvent) => {
      if (closing && /-out$/.test(event.animationName)) onExited();
    },
  };
}
