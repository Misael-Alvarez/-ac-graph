'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeParseDiagramModel, type DiagramModel, type DiagramRecord } from '@/lib/domain';
import { downloadProject } from '@/lib/editor/export';
import { useLocale } from '@/lib/i18n/useLocale';
import type { RemoteConflict } from '@/lib/store/saveCoordinator';
import {
  useDiagramDocument,
  type DiagramDocument,
  type SaveStatus,
} from '../app/useDiagramDocument';
import { EditorProvider, useEditor } from './EditorProvider';
import { useCollaboration } from './hooks/useCollaboration';
import { RemoteCursors } from './chrome/Presence';
import { Canvas } from './canvas/Canvas';
import { CodePanel } from './code/CodePanel';
import { AiDialog } from './ai/AiDialog';
import { CommandPalette } from './chrome/CommandPalette';
import { InsightsPanel } from './chrome/InsightsPanel';
import { InspectorPanel } from './chrome/InspectorPanel';
import { Minimap } from './chrome/Minimap';
import { Modals } from './chrome/Modals';
import { StatusBar } from './chrome/StatusBar';
import { ServiceBrowser } from './chrome/ServiceBrowser';
import { ShareDialog } from './chrome/ShareDialog';
import { ToolDock } from './chrome/ToolDock';
import { TopBar } from './chrome/TopBar';
import { VersionPanel } from './chrome/VersionPanel';
import { ZoomControls } from './chrome/ZoomControls';
import { ViewBar } from './chrome/ViewBar';
import { FindBar } from './chrome/FindBar';
import { Breadcrumb } from './canvas/Breadcrumb';
import { useKeyboard } from './hooks/useKeyboard';

/** Tracks the canvas element size for fit-to-view and the minimap viewport box. */
function useCanvasSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = document.querySelector('.canvas-surface');
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return size;
}

function Toast() {
  const { ui } = useEditor();
  if (!ui.toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {ui.toast}
    </div>
  );
}

/** Turns a completed cloud switch into a status message. */
function CloudSwitchAnnouncer() {
  const { doc, dispatchUi, t } = useEditor();
  const lastReported = useRef<unknown>(null);

  useEffect(() => {
    const result = doc.lastCloudSwitch;
    if (!result || result === lastReported.current) return;
    lastReported.current = result;

    let message = t('toast.switched', { count: result.switched, cloud: '' }).trim();
    if (result.skipped.length) {
      message += ` · ${t('toast.noEquivalent', {
        count: result.skipped.length,
        names: result.skipped.slice(0, 3).join(', '),
      })}`;
    }
    dispatchUi({ type: 'toast', message });
  }, [doc.lastCloudSwitch, dispatchUi, t]);

  return null;
}

/**
 * Writes the model back to storage as it changes.
 *
 * A separate component so only it re-renders on every edit, and `onChange` must
 * be referentially stable: an inline arrow here re-runs the effect on every
 * render, which restarts the debounce timer before it can ever fire — the
 * autosave silently never happens.
 */
function Autosave({ onChange }: { onChange: (model: DiagramModel) => void }) {
  const { doc } = useEditor();
  // Compared by identity rather than counting renders: a "skip the first one"
  // flag is consumed by StrictMode's double-invoked effect, which made every
  // freshly opened diagram report unsaved changes it did not have.
  const loaded = useRef(doc.model);

  useLayoutEffect(() => {
    if (doc.model === loaded.current) return;
    loaded.current = doc.model;
    // A model adopted from another editor's save is already persisted; writing
    // it back would make two editors re-save each other's work in a loop.
    if (doc.origin === 'remote') return;
    // Journal the committed model before the next paint/navigation, not only
    // when the slower IndexedDB autosave debounce expires.
    onChange(doc.model);
  }, [doc.model, doc.origin, onChange]);

  return null;
}

function EditorShell({
  documentId,
  document: document_,
  title,
  status,
  onRename,
  onSnapshot,
  onRestore,
  onRetry,
  recoveryConflict,
  recoveryUnavailable,
  remoteConflict,
  revision,
}: {
  documentId: string;
  document: DiagramDocument;
  title: string;
  status: SaveStatus;
  onRename: (title: string) => void;
  onSnapshot: (model: DiagramModel) => Promise<void>;
  onRestore: (versionId: string, model: DiagramModel) => Promise<DiagramRecord>;
  onRetry: () => Promise<void>;
  recoveryConflict: DiagramModel | null;
  recoveryUnavailable: boolean;
  remoteConflict: RemoteConflict | null;
  revision: string;
}) {
  useKeyboard();
  const { doc, ui, dispatch, dispatchUi, t } = useEditor();
  const size = useCanvasSize();
  const fileInput = useRef<HTMLInputElement>(null);

  // Somebody else's save lands on the canvas as one undo step, so the person
  // can see exactly what moved and step back if they need to.
  const applyRemote = useCallback(
    (record: DiagramRecord) => {
      dispatch({ type: 'replaceModel', model: record.model, origin: 'remote' });
      dispatchUi({ type: 'clearSelection' });
    },
    [dispatch, dispatchUi],
  );
  const applyRemoteTitle = useCallback(
    (next: string) => {
      if (next !== title) onRename(next);
    },
    [title, onRename],
  );
  const collab = useCollaboration(documentId, document_, applyRemote, applyRemoteTitle);

  useEffect(() => {
    if (!collab.lastRemoteSave) return;
    dispatchUi({
      type: 'toast',
      message: t('live.remoteSaved', { name: collab.lastRemoteSave.by.name }),
    });
  }, [collab.lastRemoteSave, dispatchUi, t]);

  const acceptRemote = () => {
    const theirs = document_.acceptRemote();
    if (theirs) applyRemote(theirs);
  };

  return (
    <div className="editor-root">
      <TopBar title={title} status={status} onRename={onRename} collab={collab} />
      {remoteConflict && (
        <div className="editor-banner is-signal" role="alert">
          <span className="editor-banner-text">
            {t('live.remoteConflict', {
              name: collab.users.find((u) => !u.self)?.name ?? '—',
            })}
          </span>
          <button
            type="button"
            className="button"
            onClick={() => downloadProject(remoteConflict.mine, 'mis-cambios.json')}
          >
            {t('live.keepMine')}
          </button>
          <button
            type="button"
            className="button is-primary"
            disabled={!remoteConflict.theirs}
            onClick={acceptRemote}
          >
            {t('live.loadRemote')}
          </button>
        </div>
      )}
      {collab.deletedBy !== null && (
        <div className="editor-banner is-danger" role="alert">
          <span className="editor-banner-text">
            {t('live.deleted', { name: collab.deletedBy || '—' })}
          </span>
          <button
            type="button"
            className="button"
            onClick={() => downloadProject(doc.model, 'copia-local.json')}
          >
            {t('live.keepMine')}
          </button>
        </div>
      )}
      {recoveryUnavailable && (
        <p className="editor-banner" role="alert">
          <span className="editor-banner-text">{t('persistence.recoveryUnavailable')}</span>
        </p>
      )}
      {status === 'error' && (
        <div className="editor-banner is-danger" role="alert">
          <span className="editor-banner-text">{t('persistence.failed')}</span>
          <button type="button" className="button" onClick={() => void onRetry().catch(() => {})}>
            {t('persistence.retry')}
          </button>
          <button type="button" className="button" onClick={() => downloadProject(doc.model)}>
            {t('export.json')}
          </button>
        </div>
      )}
      {recoveryConflict && (
        <div className="editor-banner" role="alert">
          <span className="editor-banner-text">{t('persistence.conflict')}</span>
          <button
            type="button"
            className="button"
            onClick={() => downloadProject(recoveryConflict, 'recovered-draft.json')}
          >
            {t('persistence.downloadDraft')}
          </button>
        </div>
      )}
      <div className="editor-split">
        {ui.browserOpen && <ServiceBrowser />}
        <main className="editor-stage">
          <Canvas />
          <RemoteCursors users={collab.users} />
          <Breadcrumb />
          <ViewBar />
          {ui.findOpen && <FindBar />}
          <ToolDock />
          <InspectorPanel />
          <ZoomControls size={size} />
          <Minimap size={size} />
        </main>
        {ui.codeOpen && <CodePanel />}
        {ui.versionsOpen && (
          <VersionPanel onSnapshot={onSnapshot} onRestore={onRestore} revision={revision} />
        )}
        {ui.insightsOpen && <InsightsPanel size={size} />}
      </div>
      <StatusBar status={status} />

      <CommandPalette />
      <Modals />
      <AiDialog />
      <ShareDialog />
      <Toast />
      <CloudSwitchAnnouncer />

      <input
        ref={fileInput}
        data-open-project
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          const failed = () => dispatchUi({ type: 'toast', message: t('toast.invalidFile') });
          reader.onload = () => {
            try {
              const parsed = safeParseDiagramModel(JSON.parse(String(reader.result) || 'null'));
              if (!parsed.success) {
                failed();
                return;
              }
              dispatch({ type: 'replaceModel', model: parsed.data });
              dispatchUi({ type: 'clearSelection' });
            } catch {
              failed();
            }
          };
          reader.onerror = failed;
          reader.onabort = failed;
          try {
            reader.readAsText(file);
          } catch {
            failed();
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Loads one stored diagram and hands it to the editor. */
export default function DiagramEditor({ documentId }: { documentId: string }) {
  const document_ = useDiagramDocument(documentId);
  const router = useRouter();
  const { t } = useLocale();

  if (document_.loading) {
    return <div className="page-note">{t('library.loading')}</div>;
  }

  if (document_.notFound || !document_.record) {
    return (
      <div className="page-note">
        <p>{t(document_.status === 'error' ? 'persistence.loadFailed' : 'library.notFound')}</p>
        <button type="button" className="button" onClick={() => router.push('/')}>
          {t('library.back')}
        </button>
      </div>
    );
  }

  return (
    // Remount when the id changes so the reducer starts from the right document.
    <EditorProvider
      key={document_.record.id}
      initialModel={document_.record.model}
      title={document_.record.title}
    >
      <Autosave onChange={document_.save} />
      <EditorShell
        documentId={documentId}
        document={document_}
        title={document_.record.title}
        status={document_.status}
        onRename={(title) => void document_.rename(title).catch(() => {})}
        onSnapshot={document_.snapshot}
        onRestore={document_.restore}
        onRetry={document_.retry}
        recoveryConflict={document_.recoveryConflict}
        recoveryUnavailable={document_.recoveryUnavailable}
        remoteConflict={document_.remoteConflict}
        revision={document_.record.updatedAt}
      />
    </EditorProvider>
  );
}
