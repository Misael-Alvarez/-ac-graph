'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { notifyStoreChanged } from '@/lib/browserStore';
import { onSystemThemeChange, systemPrefersDark } from '@/lib/editor/systemTheme';
import {
  PREFERENCES_KEY,
  readPreferences,
  resolveDark,
  storedTheme,
  type ThemeMode,
} from '@/lib/editor/uiState';
import { useStoredPreferences } from '@/lib/editor/usePreferences';

/**
 * The theme, outside the editor's own reducer.
 *
 * The editor owns `theme` in its UI state, but the library and the sign-in
 * page never mount that reducer — so opening the library from a dark editor
 * once threw a full-white page at the user. This reads the same stored choice,
 * asks the system the same question, and applies the same class, which makes
 * the theme a property of the app rather than of one screen.
 *
 * `system` is the default and is live: flip the operating system to dark and
 * the page follows, with no reload. Choosing light or dark by name — the
 * sun-and-moon button, ⌘⇧D, the account menu — pins it until "System" is
 * chosen again.
 *
 * Reading happens through `useStoredPreferences` and `useSyncExternalStore`
 * rather than during render: touching localStorage or `matchMedia` while
 * rendering makes the server and client markup disagree.
 */
export function useTheme(): {
  theme: ThemeMode;
  dark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggle: () => void;
} {
  const prefs = useStoredPreferences();
  const theme = storedTheme(prefs);
  const systemDark = useSyncExternalStore(
    onSystemThemeChange,
    systemPrefersDark,
    // The server has no system to ask; the markup ships dark for the same reason.
    () => true,
  );
  const dark = resolveDark(theme, systemDark);

  const accent = prefs.accent ?? 'violet';
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const setTheme = useCallback((next: ThemeMode) => {
    try {
      // Merged rather than replaced: the editor stores its own panel state
      // under the same key, and this must not be the write that forgets it.
      const stored = readPreferences(window.localStorage);
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...stored, theme: next }));
    } catch {
      // Private browsing: the choice still has to show for this session.
      document.documentElement.classList.toggle('dark', resolveDark(next, systemPrefersDark()));
      return;
    }
    notifyStoreChanged();
  }, []);

  /* The sun-and-moon button: whatever is on screen, the other one — by name. */
  const toggle = useCallback(() => setTheme(dark ? 'light' : 'dark'), [dark, setTheme]);

  return { theme, dark, setTheme, toggle };
}

/** Mounted once at the root, so every screen — the sign-in page included — wears the theme. */
export function ThemeSync() {
  useTheme();
  return null;
}
