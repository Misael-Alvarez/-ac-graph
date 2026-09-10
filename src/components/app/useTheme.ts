'use client';

import { useCallback, useEffect } from 'react';
import { notifyStoreChanged } from '@/lib/browserStore';
import { PREFERENCES_KEY, readPreferences } from '@/lib/editor/uiState';
import { useStoredPreferences } from '@/lib/editor/usePreferences';

/**
 * The stored theme, outside the editor's own reducer.
 *
 * The editor owns `dark` in its UI state, but the library never mounts that
 * reducer — so opening the library from a dark editor threw a full-white page
 * at the user every time. This reads the same stored preference and applies the
 * same class, which makes the theme a property of the app rather than of one
 * screen.
 *
 * Reading happens through `useStoredPreferences` rather than during render:
 * touching localStorage while rendering makes the server and client markup
 * disagree.
 */
export function useTheme(): { dark: boolean; toggle: () => void } {
  // Dark unless the reader has said otherwise, matching the editor's own default.
  const dark = useStoredPreferences().dark ?? true;

  const accent = useStoredPreferences().accent ?? 'violet';
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const toggle = useCallback(() => {
    try {
      // Merged rather than replaced: the editor stores its own panel state
      // under the same key, and this must not be the write that forgets it.
      const stored = readPreferences(window.localStorage);
      window.localStorage.setItem(
        PREFERENCES_KEY,
        JSON.stringify({ ...stored, dark: !(stored.dark ?? true) }),
      );
    } catch {
      // Private browsing: the toggle still has to work for this session.
      document.documentElement.classList.toggle('dark');
      return;
    }
    notifyStoreChanged();
  }, []);

  return { dark, toggle };
}
