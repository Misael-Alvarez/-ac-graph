'use client';

import { useEffect, useState } from 'react';

/** Where the sticky header ends and a section counts as "here": its scroll margin. */
const LINE_BELOW_HEADER = 16;

/**
 * Which of the page's sections the reader is in, for the header's nav.
 *
 * A section is current once its top has passed the line under the header —
 * the same line the anchors scroll to — and the last one is current at the
 * foot of the page, where a short section can never reach that line. Both
 * facts come from an IntersectionObserver rather than a scroll listener: one
 * watches the sections through a one-pixel band at the line, so it speaks
 * exactly when a section crosses it; another watches the footer, which is
 * fully in view only at the bottom. `ready` is when the sections exist.
 */
export function useActiveSection<T extends string>(ids: readonly T[], ready: boolean): T {
  const [active, setActive] = useState<T>(ids[0]);
  const key = ids.join(' ');

  useEffect(() => {
    if (!ready || typeof IntersectionObserver === 'undefined') return;
    const sections = key.split(' ') as T[];
    const header = document.querySelector<HTMLElement>('.library-header');
    const footer = document.querySelector<HTMLElement>('.library-footer');
    const line = () => (header?.offsetHeight ?? 56) + LINE_BELOW_HEADER;

    const recompute = () => {
      const at = line();
      let current = sections[0];
      for (const id of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= at + 1) current = id;
      }
      const root = document.documentElement;
      const scrollable = root.scrollHeight > window.innerHeight + 2;
      const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
      if (scrollable && atBottom) current = sections[sections.length - 1];
      setActive(current);
    };

    let band: IntersectionObserver | null = null;
    const watch = () => {
      band?.disconnect();
      const at = line();
      band = new IntersectionObserver(recompute, {
        rootMargin: `-${at}px 0px -${Math.max(0, window.innerHeight - at - 1)}px 0px`,
      });
      for (const id of sections) {
        const element = document.getElementById(id);
        if (element) band.observe(element);
      }
    };
    watch();
    const foot = footer ? new IntersectionObserver(recompute, { threshold: [0, 1] }) : null;
    if (footer) foot?.observe(footer);
    window.addEventListener('resize', watch);
    return () => {
      band?.disconnect();
      foot?.disconnect();
      window.removeEventListener('resize', watch);
    };
  }, [key, ready]);

  return active;
}
