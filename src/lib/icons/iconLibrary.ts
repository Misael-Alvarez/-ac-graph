import { z } from 'zod';
import { CustomIconSchema, type CustomIcon } from '@/lib/domain';

/** Where this browser keeps the icons its owner uploaded. */
export const ICON_LIBRARY_KEY = 'aion-studio-custom-icons';

/** Ceilings that keep the library a library and not a hard drive. */
export const MAX_LIBRARY_ICONS = 48;
export const MAX_LIBRARY_BYTES = 3 * 1024 * 1024;

const LibrarySchema = z.array(CustomIconSchema);

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The browser's icon library.
 *
 * Uploaded icons live in two places on purpose. The document embeds the ones
 * it uses, so a shared link or an export is complete on its own. The browser
 * keeps every one ever uploaded, so the next diagram can pick the same company
 * logo without uploading it again. This module is the second place.
 */
export function readIconLibrary(storage: StorageLike): CustomIcon[] {
  try {
    const raw = storage.getItem(ICON_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = LibrarySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export type LibraryWrite = { ok: true; icons: CustomIcon[] } | { ok: false; reason: 'full' };

/** Adds or replaces an icon by key, newest first, within the ceilings. */
export function saveIconToLibrary(storage: StorageLike, icon: CustomIcon): LibraryWrite {
  const rest = readIconLibrary(storage).filter((existing) => existing.key !== icon.key);
  const icons = [icon, ...rest].slice(0, MAX_LIBRARY_ICONS);
  const serialised = JSON.stringify(icons);
  if (serialised.length > MAX_LIBRARY_BYTES) return { ok: false, reason: 'full' };
  try {
    storage.setItem(ICON_LIBRARY_KEY, serialised);
  } catch {
    return { ok: false, reason: 'full' };
  }
  return { ok: true, icons };
}

/** Forgets an icon here; documents that embedded it are untouched. */
export function removeIconFromLibrary(storage: StorageLike, key: string): CustomIcon[] {
  const icons = readIconLibrary(storage).filter((icon) => icon.key !== key);
  try {
    storage.setItem(ICON_LIBRARY_KEY, JSON.stringify(icons));
  } catch {
    // Read-only storage: the in-memory answer is still right for this session.
  }
  return icons;
}
