'use client';

import { useCallback } from 'react';
import { notifyStoreChanged, useStoredValue } from '@/lib/browserStore';

/**
 * How this browser likes its library: the sort order and the starred diagrams.
 *
 * Kept in `localStorage`, per browser — a favourite is a personal bookmark,
 * not a fact about the diagram, and it needs no server round trip to be
 * useful. In server mode the diagrams themselves are shared; the stars are not.
 */
export const LIBRARY_KEY = 'aion-studio-library';

export const LIBRARY_SORTS = ['recent', 'name', 'created'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export interface LibraryPrefs {
  sort: LibrarySort;
  favourites: string[];
}

export const DEFAULT_LIBRARY_PREFS: LibraryPrefs = { sort: 'recent', favourites: [] };

export function parseLibraryPrefs(raw: string | null): LibraryPrefs {
  if (!raw) return DEFAULT_LIBRARY_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<LibraryPrefs> | null;
    const sort = LIBRARY_SORTS.includes(parsed?.sort as LibrarySort)
      ? (parsed!.sort as LibrarySort)
      : 'recent';
    const favourites = Array.isArray(parsed?.favourites)
      ? parsed!.favourites.filter((id): id is string => typeof id === 'string')
      : [];
    return { sort, favourites };
  } catch {
    return DEFAULT_LIBRARY_PREFS;
  }
}

function write(patch: Partial<LibraryPrefs>): void {
  try {
    const current = parseLibraryPrefs(window.localStorage.getItem(LIBRARY_KEY));
    window.localStorage.setItem(LIBRARY_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // A full or denied storage loses a bookmark, never the library.
  }
  notifyStoreChanged();
}

export function useLibraryPrefs(): LibraryPrefs & {
  setSort: (sort: LibrarySort) => void;
  toggleFavourite: (id: string) => void;
} {
  const prefs = useStoredValue(LIBRARY_KEY, parseLibraryPrefs, DEFAULT_LIBRARY_PREFS);
  const setSort = useCallback((sort: LibrarySort) => write({ sort }), []);
  const toggleFavourite = useCallback((id: string) => {
    const current = parseLibraryPrefs(safeRead());
    write({
      favourites: current.favourites.includes(id)
        ? current.favourites.filter((other) => other !== id)
        : [...current.favourites, id],
    });
  }, []);
  return { ...prefs, setSort, toggleFavourite };
}

function safeRead(): string | null {
  try {
    return window.localStorage.getItem(LIBRARY_KEY);
  } catch {
    return null;
  }
}

/** Favourites first, then the chosen order; stable for equal keys. */
export function sortDiagrams<
  T extends { id: string; title: string; updatedAt: string; createdAt: string },
>(items: readonly T[], sort: LibrarySort, favourites: readonly string[]): T[] {
  const starred = new Set(favourites);
  const compare = (a: T, b: T): number => {
    switch (sort) {
      case 'name':
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
      case 'created':
        return b.createdAt.localeCompare(a.createdAt);
      default:
        return b.updatedAt.localeCompare(a.updatedAt);
    }
  };
  return [...items].sort((a, b) => {
    const fa = starred.has(a.id) ? 0 : 1;
    const fb = starred.has(b.id) ? 0 : 1;
    return fa - fb || compare(a, b);
  });
}
