'use client';

import { useCallback, useMemo } from 'react';
import { contentBBox, cloneShapes, projectView, resolveView } from '@/lib/engine';
import type { ServiceIcon } from '@/lib/editor';
import type { CustomIcon } from '@/lib/domain';
import { describeDiagram } from '@/lib/editor/describe';
import { stripMetadata } from '@/lib/editor/meta';
import { spellChord } from '@/lib/editor/platform';
import { shortcutFor } from '@/lib/editor/shortcuts';
import {
  downloadMarkdown,
  downloadMermaid,
  downloadPdf,
  downloadPdfPages,
  downloadPng,
  downloadProject,
  downloadSvg,
  downloadYaml,
  fileStem,
} from '@/lib/editor/export';
import { DEFAULT_VIEWPORT, fitToBox } from '@/lib/editor/viewport';
import { createEmptyModel } from '@/lib/engine';
import { useEditor } from '../EditorProvider';
import { useIconLibraryApi, useRepository } from '@/components/app/RepositoryProvider';
import { serviceDescription } from '@/lib/i18n/serviceCopy';

export interface Command {
  id: string;
  label: string;
  /** Name resolved by `<Glyph>`; the data lives in a .ts file, so no JSX here. */
  icon: string;
  /** The chord spelled for this platform, from the shortcut registry. */
  shortcut?: string;
  enabled?: boolean;
  run: () => void;
}

export interface CommandSet extends Array<Command> {
  /** Drops a service onto the canvas at a sensible position. */
  addService: (service: ServiceIcon) => void;
  /** Drops one of the author's icons: embedded in the document, then placed. */
  addCustomService: (icon: CustomIcon, at?: { x: number; y: number }) => void;
}

/**
 * Everything the command palette, the menus and the keyboard can trigger.
 *
 * Defining commands once means a new action shows up in the palette, in a menu
 * and in the shortcut sheet without being wired three times. Shortcuts are not
 * declared here: `shortcutFor` reads them from the registry, which is also what
 * the keyboard handler consults, so the two cannot disagree.
 */
/** Commands that change the document; disabled for a viewer. */
const EDITING_COMMANDS = new Set([
  'undo',
  'redo',
  'delete',
  'duplicate',
  'autoLayout',
  'clear',
  'templates',
  'switchCloud',
  'importMarkdown',
  'openProject',
  'ai',
  'icons',
]);

export function useCommands(): CommandSet {
  const { doc, ui, view, views, dispatch, dispatchUi, canUndo, canRedo, readOnly, t, title } =
    useEditor();
  const repository = useRepository();
  // Whose the icon library is: the browser's, or the workspace's in server mode.
  const sharedIcons = useIconLibraryApi() !== null;
  const selectedIds = useMemo(
    () => new Set(view.shapes.filter((s) => ui.selectedIds.has(s.id)).map((s) => s.id)),
    [view, ui.selectedIds],
  );

  const viewportSize = useCallback(() => {
    const el = document.querySelector('.canvas-surface');
    const rect = el?.getBoundingClientRect();
    return { width: rect?.width ?? 1200, height: rect?.height ?? 800 };
  }, []);

  /** Screen edges covered by floating chrome, so fitting does not hide content. */
  const chromeInsets = useCallback(() => {
    const inspector = document.querySelector('.inspector')?.getBoundingClientRect();
    const dock = document.querySelector('.tool-dock')?.getBoundingClientRect();
    return {
      right: inspector ? inspector.width + 32 : 0,
      left: dock ? dock.width + 32 : 0,
    };
  }, []);

  const addService = useCallback(
    (service: ServiceIcon) => {
      // Place it in the middle of what the user is currently looking at.
      const { width, height } = viewportSize();
      const x = (width / 2 - ui.viewport.x) / ui.viewport.zoom - 120;
      const y = (height / 2 - ui.viewport.y) / ui.viewport.zoom - 60;
      dispatch({
        type: 'addGroup',
        x,
        y,
        service: {
          key: service.key,
          label: service.label,
          description: serviceDescription(service, ui.locale),
          category: service.category,
        },
      });
    },
    [dispatch, ui.viewport, ui.locale, viewportSize],
  );

  const addCustomService = useCallback(
    (icon: CustomIcon, at?: { x: number; y: number }) => {
      const { width, height } = viewportSize();
      const x = at ? at.x : (width / 2 - ui.viewport.x) / ui.viewport.zoom - 120;
      const y = at ? at.y : (height / 2 - ui.viewport.y) / ui.viewport.zoom - 60;
      dispatch({ type: 'addCustomIcon', icon });
      dispatch({
        type: 'addGroup',
        x,
        y,
        service: {
          key: icon.key,
          label: icon.name,
          description: icon.description ?? icon.source ?? '',
          category: 'custom',
        },
      });
    },
    [dispatch, ui.viewport, viewportSize],
  );

  /**
   * What an image or document export draws: the current reading, projected,
   * on the theme chosen for exports (the editor's own unless said otherwise),
   * with or without the metadata chips, and described for whoever cannot see it.
   */
  const exportOptions = useCallback(() => {
    const projected = projectView(view);
    return {
      model: ui.exportMeta ? projected : stripMetadata(projected),
      dark: ui.exportTheme === 'editor' ? ui.dark : ui.exportTheme === 'dark',
      brand: ui.brand,
      title,
      description: describeDiagram(projected, t),
    };
  }, [view, ui.dark, ui.brand, ui.exportTheme, ui.exportMeta, title, t]);
  const stem = fileStem(title);

  const commands = useMemo<Command[]>(() => {
    const command = (
      id: string,
      labelKey: Parameters<typeof t>[0],
      icon: string,
      run: () => void,
      enabled?: boolean,
    ): Command => {
      const chord = shortcutFor(id);
      return {
        id,
        label: t(labelKey),
        icon,
        shortcut: chord ? spellChord(chord) : undefined,
        enabled,
        run,
      };
    };
    const failed = () => dispatchUi({ type: 'toast', message: t('export.failed') });
    const exported = (name: string) =>
      dispatchUi({ type: 'toast', message: t('export.done', { name }) });

    return [
      command('undo', 'action.undo', 'undo', () => dispatch({ type: 'undo' }), canUndo),
      command('redo', 'action.redo', 'redo', () => dispatch({ type: 'redo' }), canRedo),
      command('selectAll', 'action.selectAll', 'selectAll', () =>
        dispatchUi({
          type: 'select',
          // Containers are structural and never selectable on their own.
          ids: view.shapes.filter((s) => s.type !== 'container').map((s) => s.id),
        }),
      ),
      command('deselect', 'action.deselect', 'deselect', () =>
        dispatchUi({ type: 'clearSelection' }),
      ),
      command(
        'delete',
        'action.delete',
        'delete',
        () => {
          dispatch({ type: 'deleteShapes', ids: [...selectedIds] });
          dispatchUi({ type: 'clearSelection' });
        },
        selectedIds.size > 0,
      ),
      command(
        'duplicate',
        'action.duplicate',
        'duplicate',
        () =>
          dispatch({
            type: 'paste',
            payload: cloneShapes(view, selectedIds),
            offsetX: 40,
            offsetY: 40,
          }),
        selectedIds.size > 0,
      ),
      command('autoLayout', 'action.autoLayout', 'autoLayout', () =>
        dispatch({ type: 'autoLayout', viewId: ui.activeViewId, drillPath: ui.drillPath }),
      ),
      command('zoomFit', 'action.zoomFit', 'zoomFit', () =>
        dispatchUi({
          type: 'setViewport',
          viewport: fitToBox(contentBBox(view), viewportSize(), 48, chromeInsets()),
          smooth: true,
        }),
      ),
      command('zoomReset', 'action.zoomReset', 'zoomReset', () =>
        dispatchUi({ type: 'setViewport', viewport: DEFAULT_VIEWPORT, smooth: true }),
      ),
      command('toggleTheme', 'action.toggleTheme', ui.dark ? 'sun' : 'moon', () =>
        dispatchUi({ type: 'toggleDark' }),
      ),
      command('insights', 'action.insights', 'chart', () => dispatchUi({ type: 'toggleInsights' })),
      command('toggleGrid', 'action.toggleGrid', 'grid', () =>
        dispatchUi({ type: 'toggleGridSnap' }),
      ),
      command('toggleCode', 'action.toggleCode', 'code', () => dispatchUi({ type: 'toggleCode' })),
      command('toggleBrowser', 'action.browser', 'browser', () =>
        dispatchUi({ type: 'toggleBrowser' }),
      ),
      command('toggleVersions', 'versions.title', 'history', () =>
        dispatchUi({ type: 'toggleVersions' }),
      ),
      // A viewer may talk about the drawing: never among the editing commands.
      command('toggleComments', 'comments.title', 'comments', () =>
        dispatchUi({ type: 'toggleComments' }),
      ),
      command('toggleMinimap', 'action.toggleMinimap', 'minimap', () =>
        dispatchUi({ type: 'toggleMinimap' }),
      ),
      command('ai', 'action.ai', 'ai', () => dispatchUi({ type: 'setModal', modal: 'ai' })),
      command('templates', 'action.templates', 'templates', () =>
        dispatchUi({ type: 'setModal', modal: 'templates' }),
      ),
      // A copy of the whole model, marked as a starting point: the diagram
      // being worked on stays what it is. A read and a create, like
      // duplicating, so a viewer of a shared diagram may keep one too.
      command(
        'saveAsTemplate',
        'action.saveAsTemplate',
        'templates',
        () => {
          void repository
            .create({
              title: title.trim() || t('app.untitled'),
              model: structuredClone(doc.model),
              template: true,
            })
            .then(
              () => dispatchUi({ type: 'toast', message: t('toast.templateSaved') }),
              () => dispatchUi({ type: 'toast', message: t('toast.templateFailed') }),
            );
        },
        doc.model.shapes.length > 0,
      ),
      command('switchCloud', 'action.switchCloud', 'cloud', () =>
        dispatchUi({ type: 'setModal', modal: 'switchCloud' }),
      ),
      command('importMarkdown', 'action.importMarkdown', 'import', () =>
        dispatchUi({ type: 'setModal', modal: 'markdown' }),
      ),
      command('share', 'action.share', 'share', () =>
        dispatchUi({ type: 'setModal', modal: 'share' }),
      ),
      command('exportMenu', 'export.title', 'export', () =>
        dispatchUi({ type: 'setMenu', menu: ui.menu === 'export' ? null : 'export' }),
      ),
      command('exportSvg', 'action.exportSvg', 'export', () => {
        try {
          downloadSvg(exportOptions(), `${stem}.svg`);
          exported('SVG');
        } catch {
          failed();
        }
      }),
      command('exportPng', 'action.exportPng', 'export', () => {
        downloadPng(exportOptions(), `${stem}.png`).then(() => exported('PNG'), failed);
      }),
      command('exportPdf', 'export.pdf', 'export', () => {
        downloadPdf(exportOptions(), `${stem}.pdf`).then(() => exported('PDF'), failed);
      }),
      command(
        'exportPdfViews',
        'export.pdfViews',
        'export',
        () => {
          // One page per reading, each drawn from the whole model narrowed to
          // that view — not from the reading on screen, which may be drilled.
          const base = exportOptions();
          const pages = views.map((v) => {
            const reading = projectView(resolveView(doc.model, v.id));
            return {
              ...base,
              model: ui.exportMeta ? reading : stripMetadata(reading),
              title: v.name ? `${title} — ${v.name}` : title,
              description: describeDiagram(reading, t),
            };
          });
          downloadPdfPages(pages, `${stem}.pdf`).then(() => exported('PDF'), failed);
        },
        views.length > 1,
      ),
      command('present', 'action.present', 'present', () =>
        dispatchUi({ type: 'setPresenting', on: !ui.presenting }),
      ),
      command('exportMarkdown', 'action.exportMarkdown', 'export', () => {
        downloadMarkdown(exportOptions().model, `${stem}.md`);
        exported('Markdown');
      }),
      command('exportMermaid', 'export.mermaid', 'export', () => {
        downloadMermaid(exportOptions().model, `${stem}.mmd`);
        exported('Mermaid');
      }),
      command('exportYaml', 'export.yaml', 'code', () => {
        downloadYaml(doc.model, `${stem}.yaml`, title);
        exported('YAML');
      }),
      command('openProject', 'action.open', 'open', () =>
        document.querySelector<HTMLInputElement>('[data-open-project]')?.click(),
      ),
      command('saveProject', 'action.save', 'save', () => {
        downloadProject(doc.model, `${stem}.json`);
        exported('JSON');
      }),
      command('shortcuts', 'action.shortcuts', 'shortcuts', () =>
        dispatchUi({ type: 'setModal', modal: 'shortcuts' }),
      ),
      command('icons', sharedIcons ? 'action.iconsShared' : 'action.icons', 'import', () =>
        dispatchUi({ type: 'setModal', modal: 'icons' }),
      ),
      command('find', 'action.find', 'search', () =>
        dispatchUi({ type: 'setFindOpen', open: true }),
      ),
      command('clear', 'action.clear', 'clear', () => {
        dispatch({ type: 'replaceModel', model: createEmptyModel() });
        dispatchUi({ type: 'clearSelection' });
        dispatchUi({ type: 'toast', message: t('toast.cleared') });
      }),
    ].map((entry) =>
      // A viewer keeps every command that reads — export, find, zoom, panels —
      // and sees the ones that write greyed out, in the palette and the menus alike.
      readOnly && EDITING_COMMANDS.has(entry.id) ? { ...entry, enabled: false } : entry,
    );
  }, [
    t,
    readOnly,
    views,
    ui.presenting,
    ui.exportMeta,
    canUndo,
    canRedo,
    selectedIds,
    view,
    ui.activeViewId,
    ui.drillPath,
    ui.dark,
    ui.menu,
    doc.model,
    dispatch,
    dispatchUi,
    exportOptions,
    viewportSize,
    chromeInsets,
    stem,
    title,
    repository,
    sharedIcons,
  ]);

  return useMemo(() => {
    const set = commands.slice() as CommandSet;
    set.addService = addService;
    set.addCustomService = addCustomService;
    return set;
  }, [commands, addService, addCustomService]);
}
