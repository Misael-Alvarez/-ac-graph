'use client';

import { useEffect } from 'react';
import { cloneShapes } from '@/lib/engine';
import type { ToolMode } from '@/lib/editor';
import { isTextEntryTarget } from '@/lib/editor/domFocus';
import { bindingFor, chordOf } from '@/lib/editor/shortcuts';
import { useEditor } from '../EditorProvider';
import { useCommands } from './useCommands';

export { SHORTCUT_GROUPS } from '@/lib/editor/shortcuts';

const TOOLS = new Set<ToolMode>([
  'select',
  'boundary',
  'subboundary',
  'group',
  'item',
  'connector',
  'region',
  'note',
  'text',
  'pan',
]);

/**
 * Global shortcuts.
 *
 * The keystroke is normalised into a chord and looked up in the registry, so
 * the handler has no key table of its own: what the shortcut sheet advertises
 * is, by construction, what happens. Bindings with `global` scope fire from
 * inside text fields and dialogs — a panel's own toggle has to work from
 * inside that panel — while `canvas` and `tool` bindings wait for the canvas
 * to have the keyboard.
 */
export function useKeyboard() {
  const { ui, view, dispatch, dispatchUi, canUndo, canRedo, readOnly, t } = useEditor();
  const commands = useCommands();

  useEffect(() => {
    const runCommand = (id: string) =>
      commands.find((c) => c.id === id && c.enabled !== false)?.run();
    const selectedIds = new Set(
      view.shapes.filter((s) => ui.selectedIds.has(s.id)).map((s) => s.id),
    );

    /**
     * Undo and redo, with a word when there is nothing to do.
     *
     * A silent no-op is indistinguishable from a broken shortcut; after a
     * reload, or on a diagram just opened, the history is empty and the person
     * pressing Cmd+Z deserves to be told that rather than left guessing.
     */
    const history = (id: 'undo' | 'redo') => {
      const possible = id === 'undo' ? canUndo : canRedo;
      if (possible) runCommand(id);
      else
        dispatchUi({
          type: 'toast',
          message: t(id === 'undo' ? 'toast.nothingToUndo' : 'toast.nothingToRedo'),
        });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const chord = chordOf(e);
      if (!chord) return;

      // Escape is its own thing: it closes whatever is open, then clears.
      if (chord === 'Esc') {
        if (ui.paletteOpen) dispatchUi({ type: 'setPaletteOpen', open: false });
        else if (ui.modal) dispatchUi({ type: 'setModal', modal: null });
        else if (ui.contextMenu) dispatchUi({ type: 'closeContextMenu' });
        else if (ui.presenting) {
          // Presenting: a step up out of a drilled group first, then the room.
          if (ui.drillPath.length)
            dispatchUi({ type: 'drillUpTo', depth: ui.drillPath.length - 1 });
          else dispatchUi({ type: 'setPresenting', on: false });
        } else if (!isTextEntryTarget(e.target)) {
          dispatchUi({ type: 'clearSelection' });
          dispatchUi({ type: 'setTool', tool: 'select' });
        }
        return;
      }

      const binding = bindingFor(chord);
      if (!binding) return;

      const typing = isTextEntryTarget(e.target);
      const blocked = ui.modal !== null || ui.paletteOpen;

      if (binding.scope === 'global') {
        e.preventDefault();
        switch (binding.id) {
          case 'palette':
            dispatchUi({ type: 'setPaletteOpen', open: !ui.paletteOpen });
            return;
          default:
            runCommand(binding.id);
            return;
        }
      }

      // Undo pressed inside a plain field: the field's own history goes first,
      // and when it has none — controlled inputs often do not — the drawing's
      // does. Otherwise Cmd+Z in a label that was just typed into and then left
      // alone does nothing at all, which is how "undo is broken" gets reported.
      // Rich editors (CodeMirror) keep their own undo and are left to it.
      if ((binding.id === 'undo' || binding.id === 'redo') && typing && !blocked) {
        const field = e.target as HTMLInputElement | HTMLTextAreaElement;
        if (field.tagName !== 'INPUT' && field.tagName !== 'TEXTAREA') return;
        const before = field.value;
        const id = binding.id;
        requestAnimationFrame(() => {
          if (field.isConnected && field.value === before) history(id);
        });
        return;
      }

      if (typing || blocked) return;

      if (binding.scope === 'tool') {
        // A viewer has one tool; the placing ones would only change the cursor.
        if (TOOLS.has(binding.id as ToolMode) && (!readOnly || binding.id === 'select')) {
          dispatchUi({ type: 'setTool', tool: binding.id as ToolMode });
        }
        return;
      }

      // Canvas scope.
      switch (binding.id) {
        case 'panHold':
          // Handled by the canvas itself, which tracks key-up as well.
          return;
        case 'copy': {
          if (!selectedIds.size) return;
          e.preventDefault();
          const payload = cloneShapes(view, selectedIds);
          void navigator.clipboard
            ?.writeText(JSON.stringify({ kind: 'aion-studio/shapes', payload }))
            .catch(() => undefined);
          return;
        }
        case 'paste':
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
        case 'delete':
          if (selectedIds.size) {
            e.preventDefault();
            runCommand('delete');
          } else if (view.connectors.some((c) => c.id === ui.selectedConnectorId)) {
            e.preventDefault();
            dispatch({ type: 'deleteConnector', id: ui.selectedConnectorId! });
            dispatchUi({ type: 'clearSelection' });
          }
          return;
        case 'nudge':
        case 'nudgeStep': {
          if (!selectedIds.size) return;
          e.preventDefault();
          const step = binding.id === 'nudgeStep' ? 18 : 1;
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          };
          const [dx, dy] = delta[e.key] ?? [0, 0];
          dispatch({
            type: 'moveShapes',
            ids: [...selectedIds],
            dx: dx * step,
            dy: dy * step,
            viewId: ui.activeViewId,
            drillPath: ui.drillPath,
            coalesceKey: nudgeBurst([...selectedIds]),
          });
          return;
        }
        case 'undo':
        case 'redo':
          e.preventDefault();
          history(binding.id);
          return;
        default:
          e.preventDefault();
          runCommand(binding.id);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    commands,
    ui.paletteOpen,
    ui.modal,
    ui.contextMenu,
    ui.presenting,
    ui.selectedIds,
    ui.selectedConnectorId,
    ui.activeViewId,
    ui.drillPath,
    view,
    dispatch,
    dispatchUi,
    canUndo,
    canRedo,
    readOnly,
    t,
  ]);
}

/** Arrow presses closer together than this belong to the same move. */
const NUDGE_BURST_MS = 800;

let lastNudge = { key: '', at: 0, burst: 0 };

/**
 * The history key for one keyboard move.
 *
 * Holding an arrow for two seconds is one gesture, and should come back with
 * one Cmd+Z; a second move after a pause is a new one. The pause is measured
 * here, in the handler, so the reducer stays pure.
 */
function nudgeBurst(ids: string[]): string {
  const key = ids.slice().sort().join(',');
  const now = Date.now();
  if (key !== lastNudge.key || now - lastNudge.at > NUDGE_BURST_MS) {
    lastNudge = { key, at: now, burst: lastNudge.burst + 1 };
  } else {
    lastNudge = { ...lastNudge, at: now };
  }
  return `nudge:${key}:${lastNudge.burst}`;
}
