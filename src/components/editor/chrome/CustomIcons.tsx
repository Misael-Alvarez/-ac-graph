'use client';

import { useEffect, useRef, useState } from 'react';
import type { CustomIcon } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { ACCEPTED_ICON_TYPES, readIconFile, type IconFileResult } from '@/lib/icons/customIcons';
import { ICON_LIBRARY_KEY, readIconLibrary } from '@/lib/icons/iconLibrary';
import { ImportIcon, PlusIcon, TrashIcon } from '@/components/icons/ToolIcons';
import { Field } from '@/components/ui/Field';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { Tile } from '@/components/ui/Tile';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * The browser's icon library as state, shared by every place that shows it.
 *
 * Read once from storage, and re-read when another tab or another panel writes
 * it, so the picker, the service browser and the manager never disagree about
 * what the author owns.
 */
export function useIconLibrary(): [CustomIcon[], (icons: CustomIcon[]) => void] {
  const [library, setLibrary] = useState<CustomIcon[]>(() =>
    typeof window === 'undefined' ? [] : readIconLibrary(window.localStorage),
  );
  useEffect(() => {
    const sync = (event: StorageEvent | Event) => {
      if (event instanceof StorageEvent && event.key !== null && event.key !== ICON_LIBRARY_KEY) {
        return;
      }
      setLibrary(readIconLibrary(window.localStorage));
    };
    window.addEventListener('storage', sync);
    window.addEventListener(ICON_LIBRARY_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(ICON_LIBRARY_EVENT, sync);
    };
  }, []);
  const publish = (icons: CustomIcon[]) => {
    setLibrary(icons);
    // Same tab, other panels: the storage event only fires across tabs.
    window.dispatchEvent(new Event(ICON_LIBRARY_EVENT));
  };
  return [library, publish];
}

/** Fired on `window` when this tab changes the library. */
export const ICON_LIBRARY_EVENT = 'acgraph:icon-library';

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
  onUpload,
  onPick,
  onRemove,
}: {
  t: Translate;
  icons: CustomIcon[];
  value?: string;
  showUpload: boolean;
  onUpload: () => void;
  onPick: (icon: CustomIcon) => void;
  onRemove: (key: string) => void;
}) {
  if (!icons.length && !showUpload) return null;
  return (
    <section className="icon-picker-section is-mine">
      <GroupHeader
        className="icon-picker-section-header"
        count={icons.length}
        countClassName="icon-picker-section-count"
      >
        {t('icons.mineTitle')}
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
              aria-label={`${t('icons.remove')}: ${icon.name}`}
              title={t('icons.remove')}
              onClick={() => onRemove(icon.key)}
            >
              <TrashIcon size={11} />
            </button>
          </li>
        ))}
      </ul>
      {!icons.length && showUpload && <p className="icon-picker-empty">{t('icons.empty')}</p>}
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
  onSaved: (icon: CustomIcon) => void;
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
      if (!name) setName(result.icon.name);
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
    setBusy(false);
    if (!result.ok) {
      setError(errorFor(result));
      return;
    }
    onSaved(result.icon);
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
