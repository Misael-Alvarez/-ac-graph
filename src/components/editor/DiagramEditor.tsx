'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { safeParseDiagramModel, type DiagramModel } from '@/lib/domain';
import { useLocale } from '@/lib/i18n/useLocale';
import { useDiagramDocument, type SaveStatus } from '../app/useDiagramDocument';
import { EditorProvider, useEditor } from './EditorProvider';
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

  useEffect(() => {
    if (doc.model === loaded.current) return;
    onChange(doc.model);
  }, [doc.model, onChange]);

  return null;
}

function EditorShell({
  title,
  status,
  onRename,
  onSnapshot,
  onRestored,
}: {
  title: string;
  status: SaveStatus;
  onRename: (title: string) => void;
  onSnapshot: (model: DiagramModel) => void;
  onRestored: () => void;
}) {
  useKeyboard();
  const { ui, dispatch, dispatchUi, t } = useEditor();
  const size = useCanvasSize();
  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div className="editor-root">
      <TopBar title={title} status={status} onRename={onRename} />
      <div className="editor-split">
        {ui.browserOpen && <ServiceBrowser />}
        <main className="editor-stage">
          <Canvas />
          <Breadcrumb />
          <ViewBar />
          <ToolDock />
          <InspectorPanel />
          <ZoomControls size={size} />
          <Minimap size={size} />
        </main>
        {ui.codeOpen && <CodePanel />}
        {ui.versionsOpen && <VersionPanel onSnapshot={onSnapshot} onRestored={onRestored} />}
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
          reader.onload = () => {
            const parsed = safeParseDiagramModel(JSON.parse(String(reader.result) || 'null'));
            if (!parsed.success) {
              dispatchUi({ type: 'toast', message: t('toast.invalidFile') });
              return;
            }
            dispatch({ type: 'load', model: parsed.data });
          };
          reader.readAsText(file);
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
        <p>{t('library.notFound')}</p>
        <button type="button" className="button" onClick={() => router.push('/')}>
          {t('library.back')}
        </button>
      </div>
    );
  }

  return (
    // Remount when the id changes so the reducer starts from the right document.
    <EditorProvider key={document_.record.id} initialModel={document_.record.model}>
      <Autosave onChange={document_.save} />
      <EditorShell
        title={document_.record.title}
        status={document_.status}
        onRename={(title) => void document_.rename(title)}
        onSnapshot={(model) => document_.save(model, { immediate: true, snapshot: true })}
        onRestored={() => void document_.reload()}
      />
    </EditorProvider>
  );
}
