'use client';

import { useCallback, useMemo } from 'react';
import { contentBBox, cloneShapes } from '@/lib/engine';
import type { ServiceIcon } from '@/lib/editor';
import { modKey } from '@/lib/editor/platform';
import { downloadMarkdown, downloadPng, downloadProject, downloadSvg } from '@/lib/editor/export';
import { DEFAULT_VIEWPORT, fitToBox } from '@/lib/editor/viewport';
import { createEmptyModel } from '@/lib/engine';
import { useEditor } from '../EditorProvider';
import { serviceDescription } from '@/lib/i18n/serviceCopy';

export interface Command {
  id: string;
  label: string;
  /** Emoji or short glyph shown in the palette row. */
  /** Name resolved by `<Glyph>`; the data lives in a .ts file, so no JSX here. */
  icon: string;
  shortcut?: string;
  enabled?: boolean;
  run: () => void;
}

export interface CommandSet extends Array<Command> {
  /** Drops a service onto the canvas at a sensible position. */
  addService: (service: ServiceIcon) => void;
}

/**
 * Everything the command palette, the menus and the keyboard can trigger.
 *
 * Defining commands once means a new action shows up in the palette, in a menu
 * and in the shortcut sheet without being wired three times.
 */
export function useCommands(): CommandSet {
  const { doc, ui, dispatch, dispatchUi, canUndo, canRedo, t } = useEditor();

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

  const exportOptions = useMemo(
    () => ({ model: doc.model, dark: ui.dark, brand: ui.brand }),
    [doc.model, ui.dark, ui.brand],
  );

  const commands = useMemo<Command[]>(() => {
    const m = modKey();
    return [
      {
        id: 'undo',
        label: t('action.undo'),
        icon: 'undo',
        shortcut: `${m}Z`,
        enabled: canUndo,
        run: () => dispatch({ type: 'undo' }),
      },
      {
        id: 'redo',
        label: t('action.redo'),
        icon: 'redo',
        shortcut: `${m}⇧Z`,
        enabled: canRedo,
        run: () => dispatch({ type: 'redo' }),
      },
      {
        id: 'selectAll',
        label: t('action.selectAll'),
        icon: 'selectAll',
        shortcut: `${m}A`,
        run: () =>
          dispatchUi({
            type: 'select',
            // Containers are structural and never selectable on their own.
            ids: doc.model.shapes.filter((s) => s.type !== 'container').map((s) => s.id),
          }),
      },
      {
        id: 'deselect',
        label: t('action.deselect'),
        icon: 'deselect',
        shortcut: `${m}⇧A`,
        run: () => dispatchUi({ type: 'clearSelection' }),
      },
      {
        id: 'delete',
        label: t('action.delete'),
        icon: 'delete',
        shortcut: 'Del',
        enabled: ui.selectedIds.size > 0,
        run: () => {
          dispatch({ type: 'deleteShapes', ids: [...ui.selectedIds] });
          dispatchUi({ type: 'clearSelection' });
        },
      },
      {
        id: 'duplicate',
        label: t('action.duplicate'),
        icon: 'duplicate',
        shortcut: `${m}D`,
        enabled: ui.selectedIds.size > 0,
        run: () =>
          dispatch({
            type: 'paste',
            payload: cloneShapes(doc.model, ui.selectedIds),
            offsetX: 40,
            offsetY: 40,
          }),
      },
      {
        id: 'autoLayout',
        label: t('action.autoLayout'),
        icon: 'autoLayout',
        run: () => dispatch({ type: 'autoLayout' }),
      },
      {
        id: 'zoomFit',
        label: t('action.zoomFit'),
        icon: 'zoomFit',
        shortcut: `${m}1`,
        run: () =>
          dispatchUi({
            type: 'setViewport',
            viewport: fitToBox(contentBBox(doc.model), viewportSize(), 48, chromeInsets()),
          }),
      },
      {
        id: 'zoomReset',
        label: t('action.zoomReset'),
        icon: 'zoomReset',
        shortcut: `${m}0`,
        run: () => dispatchUi({ type: 'setViewport', viewport: DEFAULT_VIEWPORT }),
      },
      {
        id: 'toggleTheme',
        label: t('action.toggleTheme'),
        icon: ui.dark ? 'sun' : 'moon',
        run: () => dispatchUi({ type: 'toggleDark' }),
      },
      {
        id: 'insights',
        label: t('action.insights'),
        icon: 'chart',
        run: () => dispatchUi({ type: 'toggleInsights' }),
      },
      {
        id: 'toggleGrid',
        label: t('action.toggleGrid'),
        icon: 'grid',
        run: () => dispatchUi({ type: 'toggleGridSnap' }),
      },
      {
        id: 'toggleCode',
        label: t('action.toggleCode'),
        icon: 'code',
        shortcut: `${m}/`,
        run: () => dispatchUi({ type: 'toggleCode' }),
      },
      {
        id: 'toggleBrowser',
        label: t('action.browser'),
        icon: 'browser',
        shortcut: `${m}B`,
        run: () => dispatchUi({ type: 'toggleBrowser' }),
      },
      {
        id: 'toggleVersions',
        label: t('versions.title'),
        icon: 'history',
        run: () => dispatchUi({ type: 'toggleVersions' }),
      },
      {
        id: 'toggleMinimap',
        label: t('action.toggleMinimap'),
        icon: 'minimap',
        run: () => dispatchUi({ type: 'toggleMinimap' }),
      },
      {
        id: 'ai',
        label: t('action.ai'),
        icon: 'ai',
        shortcut: `${m}J`,
        run: () => dispatchUi({ type: 'setModal', modal: 'ai' }),
      },
      {
        id: 'templates',
        label: t('action.templates'),
        icon: 'templates',
        run: () => dispatchUi({ type: 'setModal', modal: 'templates' }),
      },
      {
        id: 'switchCloud',
        label: t('action.switchCloud'),
        icon: 'cloud',
        run: () => dispatchUi({ type: 'setModal', modal: 'switchCloud' }),
      },
      {
        id: 'importMarkdown',
        label: t('action.importMarkdown'),
        icon: 'import',
        run: () => dispatchUi({ type: 'setModal', modal: 'markdown' }),
      },
      {
        id: 'share',
        label: t('action.share'),
        icon: 'share',
        shortcut: `${m}⇧S`,
        run: () => dispatchUi({ type: 'setModal', modal: 'share' }),
      },
      {
        id: 'exportSvg',
        label: t('action.exportSvg'),
        icon: 'export',
        run: () => downloadSvg(exportOptions),
      },
      {
        id: 'exportPng',
        label: t('action.exportPng'),
        icon: 'export',
        run: () => {
          void downloadPng(exportOptions).catch(() =>
            dispatchUi({ type: 'toast', message: t('status.error') }),
          );
        },
      },
      {
        id: 'exportMarkdown',
        label: t('action.exportMarkdown'),
        icon: 'export',
        shortcut: `${m}E`,
        run: () => downloadMarkdown(doc.model),
      },
      {
        id: 'openProject',
        label: t('action.open'),
        icon: 'open',
        run: () => document.querySelector<HTMLInputElement>('[data-open-project]')?.click(),
      },
      {
        id: 'saveProject',
        label: t('action.save'),
        icon: 'save',
        shortcut: `${m}S`,
        run: () => downloadProject(doc.model),
      },
      {
        id: 'shortcuts',
        label: t('action.shortcuts'),
        icon: 'shortcuts',
        shortcut: '?',
        run: () => dispatchUi({ type: 'setModal', modal: 'shortcuts' }),
      },
      {
        id: 'clear',
        label: t('action.clear'),
        icon: 'clear',
        run: () => {
          dispatch({ type: 'load', model: createEmptyModel() });
          dispatchUi({ type: 'clearSelection' });
          dispatchUi({ type: 'toast', message: t('toast.cleared') });
        },
      },
    ];
  }, [
    t,
    canUndo,
    canRedo,
    ui.selectedIds,
    ui.dark,
    doc.model,
    dispatch,
    dispatchUi,
    exportOptions,
    viewportSize,
    chromeInsets,
  ]);

  return useMemo(() => {
    const set = commands.slice() as CommandSet;
    set.addService = addService;
    return set;
  }, [commands, addService]);
}
