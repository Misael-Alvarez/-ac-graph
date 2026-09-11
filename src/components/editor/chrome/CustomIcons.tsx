'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomIcon } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { ACCEPTED_ICON_TYPES, readIconFile, type IconFileResult } from '@/lib/icons/customIcons';
import {
  ICON_LIBRARY_KEY,
  currentIconLibrary,
  mirrorIconLibrary,
  rememberRemoteLibrary,
  removeIconFromLibrary,
  saveIconToLibrary,
} from '@/lib/icons/iconLibrary';
import { HttpRepositoryError } from '@/lib/store/httpRepository';
import { useIconLibraryApi } from '@/components/app/RepositoryProvider';
import { ImportIcon, PlusIcon, TrashIcon } from '@/components/icons/ToolIcons';
import { Field } from '@/components/ui/Field';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { Tile } from '@/components/ui/Tile';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** What adding an icon came to: the icon to use, or why there is none. */
export type IconSaveResult =
  { ok: true; icon: CustomIcon } | { ok: false; reason: 'full' | 'failed' };

export interface IconLibrary {
  icons: CustomIcon[];
  /** The workspace's library (server mode) rather than this browser's. */
  shared: boolean;
  /**
   * Adds an icon and resolves with the one to use. In the workspace's library
   * that may be an icon already there with the same picture, under the name
   * whoever uploaded it first gave it.
   */
  save: (icon: CustomIcon) => Promise<IconSaveResult>;
  remove: (key: string) => Promise<void>;
}

/**
 * The icon library as state, shared by every place that shows it.
 *
 * In local mode it is the browser's, read from storage and re-read when
 * another tab or another panel writes it. In server mode it is the
 * workspace's: fetched when a panel that shows it mounts, written through the
 * API, and mirrored into the same storage so the picker paints at once and
 * the panels keep agreeing by the same event they always did.
 */
export function useIconLibrary(): IconLibrary {
  const api = useIconLibraryApi();
  const [library, setLibrary] = useState<CustomIcon[]>(() =>
    typeof window === 'undefined' ? [] : currentIconLibrary(window.localStorage),
  );
  useEffect(() => {
    const sync = (event: StorageEvent | Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== ICON_LIBRARY_KEY) {
        return;
      }
      setLibrary(currentIconLibrary(window.localStorage));
    };
    window.addEventListener('storage', sync);
    window.addEventListener(ICON_LIBRARY_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(ICON_LIBRARY_EVENT, sync);
    };
  }, []);

  // The workspace's list, fresh on every mount: opening the picker is the
  // moment to learn what a colleague uploaded since.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .listIcons()
      .then((icons) => {
        if (cancelled) return;
        publishRemote(icons);
      })
      .catch(() => {
        // Offline or refused: the mirror stands in until the next mount.
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const save = useCallback(
    async (icon: CustomIcon): Promise<IconSaveResult> => {
      if (api) {
        try {
          const stored = await api.saveIcon(icon);
          const rest = currentIconLibrary(window.localStorage).filter((i) => i.key !== stored.key);
          publishRemote([stored, ...rest]);
          return { ok: true, icon: stored };
        } catch (thrown) {
          const full = thrown instanceof HttpRepositoryError && thrown.code === 'library_full';
          return { ok: false, reason: full ? 'full' : 'failed' };
        }
      }
      const saved = saveIconToLibrary(window.localStorage, icon);
      if (!saved.ok) return { ok: false, reason: 'full' };
      window.dispatchEvent(new Event(ICON_LIBRARY_EVENT));
      return { ok: true, icon };
    },
    [api],
  );

  const remove = useCallback(
    async (key: string) => {
      if (api) {
        // Forgotten here whatever the server says: an icon that could not be
        // removed there comes back on the next fetch, and one already gone
        // should not linger because the answer was a 404.
        await api.removeIcon(key).catch(() => {});
        publishRemote(currentIconLibrary(window.localStorage).filter((i) => i.key !== key));
        return;
      }
      removeIconFromLibrary(window.localStorage, key);
      window.dispatchEvent(new Event(ICON_LIBRARY_EVENT));
    },
    [api],
  );

  return { icons: library, shared: api !== null, save, remove };
}

/** The server's list becomes the page's, is mirrored, and every panel hears of it. */
function publishRemote(icons: CustomIcon[]): void {
  rememberRemoteLibrary(icons);
  mirrorIconLibrary(window.localStorage, icons);
  window.dispatchEvent(new Event(ICON_LIBRARY_EVENT));
}

/** Fired on `window` when this tab changes the library. */
export const ICON_LIBRARY_EVENT = 'acgraph:icon-library';

/**
 * What the library is called, by whose it is.
 *
 * "Your icons" is true of a browser's library and false of the workspace's:
 * a colleague's logo removed there is removed for the colleague too, and the
 * words should say so before the press.
 */
export function libraryCopy(shared: boolean) {
  return shared
    ? ({
        title: 'icons.teamTitle',
        remove: 'icons.removeShared',
        empty: 'icons.emptyShared',
        subtitle: 'icons.dialogSubtitleShared',
      } as const)
    : ({
        title: 'icons.mineTitle',
        remove: 'icons.remove',
        empty: 'icons.empty',
        subtitle: 'icons.dialogSubtitle',
      } as const);
}

/**
 * A custom icon drawn inline: the sanitised vector, or the raster.
 *
 * The canvas draws these through the shared symbol sprite; the picker cannot,
 * because the icons it offers are not yet in any document.
 */
export function CustomGlyph({ icon, className }: { icon: CustomIcon; className?: string }) {
  if (icon.svg) {
    return (
      <svg
        className={className}
        viewBox={icon.svg.viewBox}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: icon.svg.body }}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- an inline data URL the author uploaded
  return <img className={className} src={icon.image} alt="" aria-hidden="true" />;
}

/**
 * Choosing the icon a shape carries.
 *
 * This was a native `<select>` over all 572 services in one flat list, ordered
 * by nothing a reader could see: finding Cloud Run meant scrolling past every
 * AWS service first. The catalogue is two-dimensional — a cloud and a
 * functional area — so the picker is too, in the same shape the service
 * browser uses. The difference is the format: browsing to place a service
 * wants a readable list of names, while picking an icon wants to see the
 * icons, so this one is a grid.
 */

/** The author's icons, with the way to add one first. */
export function MineSection({
  t,
  icons,
  value,
  showUpload,
  shared = false,
  onUpload,
  onPick,
  onRemove,
}: {
  t: Translate;
  icons: CustomIcon[];
  value?: string;
  showUpload: boolean;
  /** The workspace's library rather than this browser's: named accordingly. */
  shared?: boolean;
  onUpload: () => void;
  onPick: (icon: CustomIcon) => void;
  onRemove: (key: string) => void;
}) {
  if (!icons.length && !showUpload) return null;
  const copy = libraryCopy(shared);
  return (
    <section className="icon-picker-section is-mine">
      <GroupHeader
        className="icon-picker-section-header"
        count={icons.length}
        countClassName="icon-picker-section-count"
      >
        {t(copy.title)}
      </GroupHeader>
      <ul className="icon-picker-grid">
        {showUpload && (
          <li>
            <Tile
              className="icon-picker-tile"
              modifier="is-upload"
              onClick={onUpload}
              icon={
                <span className="icon-picker-upload-mark" aria-hidden="true">
                  <PlusIcon size={16} />
                </span>
              }
              label={t('icons.upload')}
              labelClassName="icon-picker-tile-label"
            />
          </li>
        )}
        {icons.map((icon) => (
          <li key={icon.key} className="icon-picker-mine-cell">
            <Tile
              className="icon-picker-tile"
              dataKey={icon.key}
              current={icon.key === value}
              title={[icon.description, icon.source].filter(Boolean).join(' · ') || icon.name}
              onClick={() => onPick(icon)}
              icon={<CustomGlyph icon={icon} className="icon-picker-tile-icon" />}
              label={icon.name}
              labelClassName="icon-picker-tile-label"
            />
            <button
              type="button"
              className="icon-picker-remove"
              aria-label={`${t(copy.remove)}: ${icon.name}`}
              title={t(copy.remove)}
              onClick={() => onRemove(icon.key)}
            >
              <TrashIcon size={11} />
            </button>
          </li>
        ))}
      </ul>
      {!icons.length && showUpload && <p className="icon-picker-empty">{t(copy.empty)}</p>}
    </section>
  );
}

/**
 * Uploading an icon: the file, and the words that make it findable later.
 *
 * The name is what the card and the picker show; the description is for whoever
 * reads the diagram and wonders what the mark means; source and tags are how
 * the icon is found again in a library of forty.
 */
export function UploadForm({
  t,
  onCancel,
  onSaved,
}: {
  t: Translate;
  onCancel: () => void;
  /** Keeps the icon; the form stays, with the reason, when it could not be kept. */
  onSaved: (icon: CustomIcon) => Promise<IconSaveResult>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState('');
  const [tags, setTags] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CustomIcon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const errorFor = (result: IconFileResult): string | null =>
    result.ok
      ? null
      : t(
          result.reason === 'type'
            ? 'icons.errorType'
            : result.reason === 'size'
              ? 'icons.errorSize'
              : 'icons.errorInvalid',
        );

  const choose = async (chosen: File | null) => {
    setFile(chosen);
    setPreview(null);
    setError(null);
    if (!chosen) return;
    const result = await readIconFile(chosen, {
      name: name || chosen.name.replace(/\.[^.]+$/, ''),
    });
    if (result.ok) {
      setPreview(result.icon);
      // The file's name only fills a name still empty *now*: reading the file
      // takes a moment, and a name typed in that moment must not be overwritten.
      setName((current) => current || result.icon.name);
    } else setError(errorFor(result));
  };

  const save = async () => {
    if (!name.trim()) {
      setError(t('icons.errorName'));
      return;
    }
    if (!file) {
      fileRef.current?.click();
      return;
    }
    setBusy(true);
    const result = await readIconFile(file, {
      name,
      description,
      source,
      tags: tags.split(',').map((tag) => tag.trim()),
    });
    if (!result.ok) {
      setBusy(false);
      setError(errorFor(result));
      return;
    }
    const outcome = await onSaved(result.icon);
    setBusy(false);
    if (!outcome.ok) {
      setError(t(outcome.reason === 'full' ? 'icons.errorFull' : 'icons.errorFailed'));
    }
  };

  return (
    <form
      className="icon-upload"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="icon-upload-head">
        <GroupHeader as="span" className="icon-picker-section-header">
          {t('icons.upload')}
        </GroupHeader>
        <button type="button" className="button is-small" onClick={onCancel}>
          {t('icons.cancel')}
        </button>
      </div>

      <label className="icon-upload-drop">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_ICON_TYPES.join(',')}
          onChange={(e) => void choose(e.target.files?.[0] ?? null)}
        />
        <span className="icon-upload-preview" aria-hidden="true">
          {preview ? <CustomGlyph icon={preview} /> : <ImportIcon size={20} />}
        </span>
        <span className="icon-upload-text">
          <b>{file ? file.name : t('icons.chooseFile')}</b>
          <small>{file ? t('icons.changeFile') : t('icons.uploadHint')}</small>
        </span>
      </label>

      <Field label={t('icons.name')}>
        <input
          className="input"
          value={name}
          maxLength={60}
          placeholder={t('icons.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label={t('icons.description')}>
        <input
          className="input"
          value={description}
          maxLength={240}
          placeholder={t('icons.descriptionPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="icon-upload-row">
        <Field label={t('icons.source')}>
          <input
            className="input"
            value={source}
            maxLength={40}
            placeholder={t('icons.sourcePlaceholder')}
            onChange={(e) => setSource(e.target.value)}
          />
        </Field>
        <Field label={t('icons.tags')}>
          <input
            className="input"
            value={tags}
            placeholder={t('icons.tagsPlaceholder')}
            onChange={(e) => setTags(e.target.value)}
          />
        </Field>
      </div>

      {error && (
        <p className="icon-upload-error" role="alert">
          {error}
        </p>
      )}

      <div className="icon-upload-actions">
        <button type="submit" className="button is-primary" disabled={busy}>
          {t('icons.save')}
        </button>
      </div>
    </form>
  );
}
