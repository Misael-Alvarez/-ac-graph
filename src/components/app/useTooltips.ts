'use client';

import { useEffect } from 'react';

/** How long the pointer rests before a tooltip appears; then no wait between neighbours. */
const SHOW_DELAY_MS = 420;
const NEIGHBOUR_GRACE_MS = 260;
/** The separator the app uses between a label and its shortcut in a `title`. */
const CHORD_SEPARATOR = ' · ';

/**
 * The app's own tooltips, for every `title` in it.
 *
 * The browser's tooltip arrives a second late, in the system font, in a box
 * from another decade, and nowhere near where the eye is. This replaces it
 * without touching a single component: the first time the pointer rests on
 * anything with a `title`, the text moves into `data-tooltip` — which is what
 * stops the native one — and a small pane appears beside the control, with the
 * shortcut set as a key. Moving straight to a neighbour shows its tooltip at
 * once, as a menu bar would. Keyboard focus shows it too, so the shortcut a
 * tooltip teaches is available to the people most likely to want it.
 *
 * The accessible name survives the move: a control named only by its `title`
 * is given an `aria-label` before the title is taken away.
 */
export function useTooltips(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const pane = document.createElement('div');
    pane.className = 'tooltip';
    pane.setAttribute('role', 'tooltip');
    pane.hidden = true;
    document.body.appendChild(pane);

    let current: HTMLElement | null = null;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let recentlyShown = false;

    const claim = (element: HTMLElement) => {
      const title = element.getAttribute('title');
      if (title === null) return;
      if (title.trim() && !element.hasAttribute('aria-label') && !element.textContent?.trim()) {
        element.setAttribute('aria-label', title);
      }
      element.dataset.tooltip = title;
      element.removeAttribute('title');
    };

    const render = (element: HTMLElement) => {
      const text = element.dataset.tooltip ?? '';
      if (!text.trim()) return;
      const [label, chord] = text.split(CHORD_SEPARATOR);
      pane.replaceChildren();
      const span = document.createElement('span');
      span.textContent = label;
      pane.appendChild(span);
      if (chord) {
        const kbd = document.createElement('kbd');
        kbd.textContent = chord;
        pane.appendChild(kbd);
      }
      const retarget = !pane.hidden;
      pane.hidden = false;
      // A second tooltip right after the first appears at once, with no
      // entrance: the reader is scanning a toolbar, and a fade on each stop
      // would make the whole bar feel slower than it is.
      pane.classList.toggle('is-instant', retarget || recentlyShown);
      if (!retarget) pane.classList.remove('is-visible');

      // Below the control, centred; above it when there is no room below;
      // beside it when the control asks (the dock hugs the left edge).
      const side = element.closest<HTMLElement>('[data-tooltip-side]')?.dataset.tooltipSide;
      const anchor = element.getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      const gap = 8;
      let left: number;
      let top: number;
      if (side === 'right') {
        left = anchor.right + gap;
        top = anchor.top + anchor.height / 2 - box.height / 2;
        pane.dataset.side = 'right';
      } else {
        left = anchor.left + anchor.width / 2 - box.width / 2;
        const below = anchor.bottom + gap;
        const fitsBelow = below + box.height <= window.innerHeight - 8;
        top = fitsBelow ? below : anchor.top - gap - box.height;
        pane.dataset.side = fitsBelow ? 'bottom' : 'top';
      }
      left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - box.height - 8));
      pane.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      // Two frames: one for the position to land, one for the transition.
      if (retarget) pane.classList.add('is-visible');
      else requestAnimationFrame(() => pane.classList.add('is-visible'));
    };

    const hide = () => {
      if (showTimer) clearTimeout(showTimer);
      showTimer = null;
      if (!pane.hidden) {
        pane.classList.remove('is-visible');
        pane.hidden = true;
        recentlyShown = true;
        if (graceTimer) clearTimeout(graceTimer);
        graceTimer = setTimeout(() => {
          recentlyShown = false;
        }, NEIGHBOUR_GRACE_MS);
      }
      current = null;
    };

    const target = (event: Event): HTMLElement | null => {
      const node = event.target;
      if (!(node instanceof Element)) return null;
      const element = node.closest<HTMLElement>('[title], [data-tooltip]');
      // Form fields keep their native behaviour; the canvas has its own hints.
      if (!element || element.matches('input, textarea, select, svg.canvas-surface')) return null;
      return element;
    };

    /**
     * Whether a tooltip would only repeat what the control already shows.
     *
     * A list row whose label is fully visible needs no tooltip saying the same
     * label again — and in a vertical list a pane popping in and out under the
     * pointer at every row boundary read as the interface shaking.
     */
    const redundant = (element: HTMLElement, text: string): boolean => {
      const visible = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      return visible.length > 0 && text.replace(/\s+/g, ' ').trim() === visible;
    };

    const onOver = (event: PointerEvent) => {
      const element = target(event);
      if (!element) return;
      if (element === current) return;
      claim(element);
      const text = element.dataset.tooltip?.trim() ?? '';
      if (!text || redundant(element, text)) {
        hide();
        return;
      }
      // Moving straight from one control to its neighbour keeps the pane on
      // screen and retargets it in place: no blink, no shake.
      const wasVisible = !pane.hidden;
      if (showTimer) clearTimeout(showTimer);
      showTimer = null;
      current = element;
      if (wasVisible || recentlyShown) render(element);
      else showTimer = setTimeout(() => render(element), SHOW_DELAY_MS);
    };
    const onOut = (event: PointerEvent) => {
      if (!current) return;
      const to = event.relatedTarget;
      if (to instanceof Node && current.contains(to)) return;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const element = target(event);
      if (!element || !element.matches(':focus-visible')) return;
      hide();
      claim(element);
      if (!element.dataset.tooltip?.trim()) return;
      current = element;
      showTimer = setTimeout(() => render(element), SHOW_DELAY_MS);
    };
    const onScrollOrPress = () => hide();

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onScrollOrPress, true);
    document.addEventListener('pointerdown', onScrollOrPress, true);
    document.addEventListener('keydown', onScrollOrPress, true);
    document.addEventListener('scroll', onScrollOrPress, true);

    return () => {
      hide();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onScrollOrPress, true);
      document.removeEventListener('pointerdown', onScrollOrPress, true);
      document.removeEventListener('keydown', onScrollOrPress, true);
      document.removeEventListener('scroll', onScrollOrPress, true);
      pane.remove();
    };
  }, []);
}
