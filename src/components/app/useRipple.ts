'use client';

import { useEffect } from 'react';

/**
 * A press that leaves a mark where the finger landed.
 *
 * The point is that the ink starts at the point of contact rather than in the
 * middle of the control: a ripple that always begins at the centre reads as an
 * animation playing, while one that begins under the pointer reads as the
 * button answering.
 *
 * One listener for the whole app rather than a handler on forty buttons. The
 * ink is a span the gesture creates and its own animation removes, so nothing
 * is rendered ahead of a press that may never come.
 */
const TAKES_INK = [
  '.button',
  '.icon-button',
  '.browser-tile',
  '.icon-picker-tile',
  '.template-card',
  '.cloud-chip',
  '.cloud-card',
  '.segmented-option',
  '.context-menu-item',
  '.palette-row',
  '.ai-chip',
].join(',');

/**
 * The home page answers a press with a scale, in a frame or two, and nothing
 * else: a spreading stain that outlasts the tap by half a second is the
 * opposite of the crispness that page is built on.
 */
const KEEPS_DRY = '.library';

export function useGlobalRipple(): void {
  useEffect(() => {
    // Motion the reader has asked not to see is motion not worth creating.
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || still.matches) return;

      const target = event.target as Element | null;
      const host = target?.closest<HTMLElement>(TAKES_INK);
      if (!host || host.hasAttribute('disabled') || host.closest(KEEPS_DRY)) return;

      const rect = host.getBoundingClientRect();
      // Reach for the farthest corner, so the ink always covers the control.
      const radius = Math.hypot(
        Math.max(event.clientX - rect.left, rect.right - event.clientX),
        Math.max(event.clientY - rect.top, rect.bottom - event.clientY),
      );

      const ink = document.createElement('span');
      ink.className = 'ripple';
      ink.style.width = ink.style.height = `${radius * 2}px`;
      ink.style.left = `${event.clientX - rect.left - radius}px`;
      ink.style.top = `${event.clientY - rect.top - radius}px`;
      ink.addEventListener('animationend', () => ink.remove(), { once: true });
      host.appendChild(ink);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);
}
