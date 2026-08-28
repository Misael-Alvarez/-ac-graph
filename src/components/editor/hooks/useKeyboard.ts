'use client';

import { useEffect } from 'react';
import { cloneShapes } from '@/lib/engine';
import type { ToolMode } from '@/lib/editor';
import { isTextEntryTarget } from '@/lib/editor/domFocus';
import type { MessageKey } from '@/lib/i18n/messages';
import { useEditor } from '../EditorProvider';
import { useCommands } from './useCommands';

const TOOL_KEYS: Record<string, ToolMode> = {
  v: 'select',
  b: 'boundary',
  u: 'subboundary',
  g: 'group',
  i: 'item',
  c: 'connector',
  h: 'pan',
};

/**
 * Global shortcuts.
 *
 * Every binding advertised in the menus and the shortcut sheet is implemented
 * here — the previous editor showed `Ctrl+S` next to "Save project" and
 * `Ctrl+Shift+A` next to "Deselect" while handling neither, so both fell through
 * to the browser.
 */
export function useKeyboard() {
  const { ui, doc, dispatch, dispatchUi, t } = useEditor();
  const commands = useCommands();

  useEffect(() => {
    const runCommand = (id: string) => commands.find((c) => c.id === id)?.run();

    const onKeyDown = (e: KeyboardEvent) => {
      const modifier = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      /*
       * Application shortcuts, handled before the typing guard below.
       *
       * These have no meaning inside a text field, and a panel's own toggle has
       * to work from inside that panel — otherwise the code editor can be opened
       * with a shortcut but not closed with one.
       */
      if (modifier) {
        switch (key) {
          case 'k':
            e.preventDefault();
            dispatchUi({ type: 'setPaletteOpen', open: !ui.paletteOpen });
            return;
          case '/':
            e.preventDefault();
            runCommand('toggleCode');
            return;
          case 'j':
            e.preventDefault();
            runCommand('ai');
            return;
          case 'b':
            e.preventDefault();
            runCommand('toggleBrowser');
            return;
          case 's':
            // Without this the browser's own save dialog opens.
            e.preventDefault();
            runCommand(e.shiftKey ? 'share' : 'saveProject');
            return;
          case 'e':
            e.preventDefault();
            runCommand('exportMarkdown');
            return;
          default:
            break;
        }
      }

      if (e.key === 'Escape') {
        if (ui.paletteOpen) dispatchUi({ type: 'setPaletteOpen', open: false });
        else if (ui.modal) dispatchUi({ type: 'setModal', modal: null });
        else {
          dispatchUi({ type: 'clearSelection' });
          dispatchUi({ type: 'setTool', tool: 'select' });
        }
        return;
      }

      if (isTextEntryTarget(e.target)) return;

      if (modifier) {
        switch (key) {
          case 'z':
            e.preventDefault();
            runCommand(e.shiftKey ? 'redo' : 'undo');
            return;
          case 'y':
            e.preventDefault();
            runCommand('redo');
            return;
          case 'a':
            e.preventDefault();
            runCommand(e.shiftKey ? 'deselect' : 'selectAll');
            return;
          case 'd':
            e.preventDefault();
            runCommand('duplicate');
            return;
          case '0':
            e.preventDefault();
            runCommand('zoomReset');
            return;
          case '1':
            e.preventDefault();
            runCommand('zoomFit');
            return;
          case 'c':
            if (ui.selectedIds.size) {
              e.preventDefault();
              const payload = cloneShapes(doc.model, ui.selectedIds);
              void navigator.clipboard
                ?.writeText(JSON.stringify({ kind: 'aion-studio/shapes', payload }))
                .catch(() => undefined);
            }
            return;
          case 'v':
            navigator.clipboard
              ?.readText()
              .then((text) => {
                const parsed = JSON.parse(text) as { kind?: string; payload?: unknown };
                if (parsed.kind !== 'aion-studio/shapes' || !parsed.payload) return;
                dispatch({
                  type: 'paste',
                  payload: parsed.payload as ReturnType<typeof cloneShapes>,
                  offsetX: 40,
                  offsetY: 40,
                });
              })
              .catch(() => undefined);
            return;
          default:
            return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ui.selectedIds.size) {
          e.preventDefault();
          runCommand('delete');
        } else if (ui.selectedConnectorId) {
          e.preventDefault();
          dispatch({ type: 'deleteConnector', id: ui.selectedConnectorId });
          dispatchUi({ type: 'clearSelection' });
        }
        return;
      }

      if (e.key === '?') {
        dispatchUi({ type: 'setModal', modal: 'shortcuts' });
        return;
      }

      // Nudge the selection with the arrow keys; Shift moves a full grid step.
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (e.key in nudge && ui.selectedIds.size) {
        e.preventDefault();
        const step = e.shiftKey ? 18 : 1;
        const [dx, dy] = nudge[e.key];
        dispatch({
          type: 'moveShapes',
          ids: [...ui.selectedIds],
          dx: dx * step,
          dy: dy * step,
          viewId: ui.activeViewId,
        });
        return;
      }

      const tool = TOOL_KEYS[key];
      if (tool) dispatchUi({ type: 'setTool', tool });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    commands,
    ui.paletteOpen,
    ui.modal,
    ui.selectedIds,
    ui.selectedConnectorId,
    ui.activeViewId,
    doc.model,
    dispatch,
    dispatchUi,
    t,
  ]);
}

/** Bindings shown in the shortcut sheet, kept next to the handler above. */
/**
 * The shortcut sheet's contents.
 *
 * `Mod` is written out rather than spelled: the sheet renders it through
 * `shortcut()`, so the same table reads ⌘ on a Mac and Ctrl+ everywhere else.
 * The group titles are message keys like everything else the reader sees — they
 * were the last three English words in the Spanish build.
 */
export const SHORTCUT_GROUPS: {
  titleKey: MessageKey;
  items: [keys: string, description: MessageKey][];
}[] = [
  {
    titleKey: 'shortcuts.tools',
    items: [
      ['V', 'tool.select'],
      ['B', 'tool.boundary'],
      ['U', 'tool.subboundary'],
      ['G', 'tool.group'],
      ['I', 'tool.item'],
      ['C', 'tool.connector'],
      ['Space', 'action.zoomFit'],
    ],
  },
  {
    titleKey: 'shortcuts.edit',
    items: [
      ['Mod+Z', 'action.undo'],
      ['Mod+Shift+Z', 'action.redo'],
      ['Mod+A', 'action.selectAll'],
      ['Mod+Shift+A', 'action.deselect'],
      ['Mod+D', 'action.duplicate'],
      ['Del', 'action.delete'],
      ['Arrows', 'action.autoLayout'],
    ],
  },
  {
    titleKey: 'shortcuts.fileView',
    items: [
      ['Mod+K', 'palette.placeholder'],
      ['Mod+B', 'action.browser'],
      ['Mod+/', 'action.toggleCode'],
      ['Mod+J', 'action.ai'],
      ['Mod+S', 'action.save'],
      ['Mod+Shift+S', 'action.share'],
      ['Mod+E', 'action.exportMarkdown'],
      ['Mod+0', 'action.zoomReset'],
      ['Mod+1', 'action.zoomFit'],
      ['?', 'action.shortcuts'],
    ],
  },
];
