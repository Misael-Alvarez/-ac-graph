/**
 * What the operating system says about light and dark, and when it changes.
 *
 * One media query, read where it is needed and never during server rendering
 * (there is no system there: the answer is "dark", which is what the markup
 * ships as, so nothing flashes). Wrapped so the editor's reducer and the
 * screens outside it subscribe to the same signal the same way.
 */
const QUERY = '(prefers-color-scheme: dark)';

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

/** True when the system prefers dark — and on the server, where the page starts dark. */
export function systemPrefersDark(): boolean {
  return media()?.matches ?? true;
}

/** Calls `listener` whenever the system's preference flips; returns the unsubscribe. */
export function onSystemThemeChange(listener: () => void): () => void {
  const query = media();
  if (!query) return () => undefined;
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
