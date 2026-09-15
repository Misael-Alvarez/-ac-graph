'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageKey } from '@/lib/i18n/messages';
import type { WorkspaceExport } from '@/lib/store';
import { DownloadIcon, ImportIcon } from '@/components/icons/ToolIcons';
import { useRepository } from '../app/RepositoryProvider';

interface WorkspaceActionsProps {
  onChanged: () => void | Promise<void>;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

/**
 * Export and import of the whole workspace.
 *
 * This is what makes the local store an honest place to keep work: everything
 * can be taken out in one file and put back. It is also the migration path to
 * the cloud — the import side is the same regardless of which repository is
 * behind it.
 */
export function WorkspaceActions({ onChanged, t }: WorkspaceActionsProps) {
  const repository = useRepository();
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const clearing = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Says something for four seconds. Cleared on unmount, so a message that
      outlives its component cannot set state on it. */
  const say = useCallback((text: string) => {
    setMessage(text);
    if (clearing.current) clearTimeout(clearing.current);
    clearing.current = setTimeout(() => setMessage(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (clearing.current) clearTimeout(clearing.current);
    },
    [],
  );

  const download = async () => {
    try {
      const dump = await repository.exportWorkspace();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `architecture-workspace-${dump.exportedAt.slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // The import side has always reported its failures; a silent export is
      // worse, because nothing appears in the downloads folder either.
      say(t('toast.exportFailed'));
    }
  };

  const upload = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as WorkspaceExport;
      const count = await repository.importWorkspace(parsed);
      say(t('library.imported', { count }));
      await onChanged();
    } catch {
      say(t('toast.invalidFile'));
    }
  };

  /* Named by `aria-label` and `title` as well as by their text: below 900px the
     header keeps only the icons, and the name has to survive that — for the
     screen reader, and for the tooltip the title becomes. */
  return (
    <>
      <button
        type="button"
        className="button is-ghost"
        title={t('library.import')}
        aria-label={t('library.import')}
        onClick={() => fileInput.current?.click()}
      >
        <ImportIcon size={15} />
        <span className="button-label">{t('library.import')}</span>
      </button>
      <button
        type="button"
        className="button is-ghost"
        title={t('library.export')}
        aria-label={t('library.export')}
        onClick={() => void download()}
      >
        <DownloadIcon size={15} />
        <span className="button-label">{t('library.export')}</span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
      {message && (
        <span className="library-message" role="status">
          {message}
        </span>
      )}
    </>
  );
}
