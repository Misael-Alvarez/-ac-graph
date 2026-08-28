import { applyPatches, current, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { DiagramModel } from '@/lib/domain';
import * as E from '@/lib/engine';
import type { SwitchCloudResult } from '@/lib/engine';
import type { EditorAction } from './actions';
import { PROVIDER_COLORS } from './providers';

enablePatches();

/** How many undo steps to retain. Patches are small, so this can be generous. */
const HISTORY_LIMIT = 200;

interface HistoryEntry {
  redo: Patch[];
  undo: Patch[];
}

export interface DocState {
  model: DiagramModel;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** IDs created by the last action, so the UI can select them. */
  lastCreated: string[];
  /** Outcome of the last cloud switch, for the status toast. */
  lastCloudSwitch: SwitchCloudResult | null;
}

export function initialDocState(model: DiagramModel): DocState {
  return { model, past: [], future: [], lastCreated: [], lastCloudSwitch: null };
}

export const canUndo = (s: DocState) => s.past.length > 0;
export const canRedo = (s: DocState) => s.future.length > 0;

interface ActionOutcome {
  /** IDs created by the action, so the UI can select them. */
  created: string[];
  /** Populated only by a cloud switch, for the status toast. */
  cloudSwitch?: SwitchCloudResult;
}

const NOTHING: ActionOutcome = { created: [] };
const madeIds = (...ids: string[]): ActionOutcome => ({ created: ids });

/**
 * Applies one action to an Immer draft.
 *
 * All engine helpers mutate in place, which is exactly the contract Immer drafts
 * expect, so the engine needed no changes to work under a reducer.
 */
function applyAction(draft: DiagramModel, action: EditorAction): ActionOutcome {
  switch (action.type) {
    case 'replaceModel': {
      // Assigning the collections lets Immer diff them, so undo still works and
      // untouched shapes keep their identity.
      draft.canvas = action.model.canvas;
      draft.shapes = action.model.shapes;
      draft.connectors = action.model.connectors;
      draft.showFooter = action.model.showFooter;
      return NOTHING;
    }

    case 'addBoundary': {
      const s = E.addBoundary(draft, action.x, action.y, action.variant);
      return madeIds(s.id);
    }

    case 'addGroup': {
      const group = E.addGroup(draft, action.x, action.y);
      const created = [group.id];
      const container = E.children(draft, group.id).find((s) => s.type === 'container');
      if (container) created.push(container.id);
      if (action.service && container) {
        // Dropping a service from the palette colours the group by provider.
        const colors = PROVIDER_COLORS[action.service.category] ?? PROVIDER_COLORS.generic;
        group.title = action.service.label;
        group.fill = colors.fill;
        container.fill = colors.border;
        const item = E.children(draft, container.id).find((s) => s.type === 'item');
        if (item) {
          item.title = action.service.label;
          item.subtitle = action.service.description ?? '';
          item.icon = { kind: 'symbol', key: action.service.key };
          created.push(item.id);
        }
      } else if (container) {
        const item = E.children(draft, container.id).find((s) => s.type === 'item');
        if (item) created.push(item.id);
      }
      return { created };
    }

    case 'addItem': {
      const item = E.addItemToContainer(draft, action.containerId);
      return item ? madeIds(item.id) : NOTHING;
    }

    case 'deleteShapes': {
      for (const id of action.ids) E.deleteShape(draft, id);
      return NOTHING;
    }

    case 'moveShapes': {
      const moved = new Set<string>();
      for (const id of action.ids) {
        const shape = E.getShape(draft, id);
        if (!shape) continue;
        // A selected descendant would otherwise be shifted twice.
        if (action.ids.some((other) => other !== id && E.isAncestor(draft, id, other))) continue;
        for (const descendantId of E.collectDescendantIds(draft, id)) moved.add(descendantId);
      }
      for (const id of moved) {
        const shape = E.getShape(draft, id);
        if (!shape) continue;
        shape.x += action.dx;
        shape.y += action.dy;
      }
      E.routeConnectorsFor(draft, moved);
      return NOTHING;
    }

    case 'resizeShape': {
      const shape = E.getShape(draft, action.id);
      if (!shape) return NOTHING;
      shape.w = action.w;
      shape.h = action.h;
      shape.manualSize = true;
      if (shape.type === 'group') E.relayoutGroup(draft, shape);
      E.routeConnectorsFor(draft, E.collectDescendantIds(draft, action.id));
      return NOTHING;
    }

    case 'setShapeProps': {
      const shape = E.getShape(draft, action.id);
      if (!shape) return NOTHING;
      Object.assign(shape, action.patch);
      if (shape.type === 'group') E.relayoutGroup(draft, shape);
      E.routeConnectorsFor(draft, E.collectDescendantIds(draft, action.id));
      return NOTHING;
    }

    case 'alignShapes': {
      const moves = E.alignMoves(draft, action.ids, action.edge);
      E.applyMoves(draft, moves);
      E.routeConnectorsFor(
        draft,
        new Set(action.ids.flatMap((id) => [...E.collectDescendantIds(draft, id)])),
      );
      return NOTHING;
    }

    case 'distributeShapes': {
      const moves = E.distributeMoves(draft, action.ids, action.axis);
      E.applyMoves(draft, moves);
      E.routeConnectorsFor(
        draft,
        new Set(action.ids.flatMap((id) => [...E.collectDescendantIds(draft, id)])),
      );
      return NOTHING;
    }

    case 'reorderItem': {
      E.reorderItem(draft, action.id, action.dir);
      const parentId = E.getShape(draft, action.id)?.parentId;
      if (parentId) E.routeConnectorsFor(draft, E.collectDescendantIds(draft, parentId));
      return NOTHING;
    }

    case 'bringToFront':
    case 'sendToBack': {
      const idx = draft.shapes.findIndex((s) => s.id === action.id);
      if (idx < 0) return NOTHING;
      const [shape] = draft.shapes.splice(idx, 1);
      if (action.type === 'bringToFront') draft.shapes.push(shape);
      else draft.shapes.unshift(shape);
      return NOTHING;
    }

    case 'addConnector': {
      const c = E.addConnector(draft, action.sourceId, action.targetId);
      return madeIds(c.id);
    }

    case 'deleteConnector': {
      E.deleteConnector(draft, action.id);
      return NOTHING;
    }

    case 'reverseConnector': {
      const connector = draft.connectors.find((c) => c.id === action.id);
      if (!connector) return NOTHING;
      [connector.sourceId, connector.targetId] = [connector.targetId, connector.sourceId];
      E.routeConnector(draft, connector);
      return NOTHING;
    }

    case 'setConnectorProps': {
      const c = draft.connectors.find((x) => x.id === action.id);
      if (c) Object.assign(c, action.patch);
      return NOTHING;
    }

    case 'paste': {
      const ids = E.pasteShapes(draft, action.payload, action.offsetX, action.offsetY);
      E.routeConnectorsFor(draft, ids);
      return madeIds(...ids);
    }

    case 'duplicateShapes': {
      // `current` first: the clipboard helper deep-clones what it reads, and
      // structuredClone cannot copy an Immer draft's proxies.
      const payload = E.cloneShapes(current(draft), new Set(action.ids));
      if (!payload.shapes.length) return NOTHING;
      const ids = E.pasteShapes(draft, payload, 40, 40);
      E.routeConnectorsFor(draft, ids);
      return madeIds(...ids);
    }

    case 'autoLayout': {
      E.autoLayout(draft);
      return NOTHING;
    }

    case 'switchShapeCloud': {
      E.switchShapeCloud(draft, action.id, action.target, action.locale);
      return NOTHING;
    }

    case 'switchCloud': {
      return { created: [], cloudSwitch: E.switchCloud(draft, action.target, action.locale) };
    }

    default:
      return NOTHING;
  }
}

export function docReducer(state: DocState, action: EditorAction): DocState {
  switch (action.type) {
    case 'load':
      return initialDocState(action.model);

    case 'undo': {
      const entry = state.past.at(-1);
      if (!entry) return state;
      return {
        ...state,
        model: applyPatches(state.model, entry.undo),
        past: state.past.slice(0, -1),
        future: [entry, ...state.future],
        lastCreated: [],
      };
    }

    case 'redo': {
      const [entry, ...rest] = state.future;
      if (!entry) return state;
      return {
        ...state,
        model: applyPatches(state.model, entry.redo),
        past: [...state.past, entry],
        future: rest,
        lastCreated: [],
      };
    }

    default: {
      let outcome: ActionOutcome = NOTHING;
      const [model, redo, undo] = produceWithPatches(state.model, (draft) => {
        outcome = applyAction(draft, action);
      });
      if (redo.length === 0) {
        // The model is unchanged, so no undo step — but the action may still have
        // something to report, such as a cloud switch where nothing had an
        // equivalent. Swallowing that would leave the user with silence.
        if (outcome.cloudSwitch) {
          return { ...state, lastCreated: [], lastCloudSwitch: outcome.cloudSwitch };
        }
        return state;
      }
      return {
        model,
        past: [...state.past, { redo, undo }].slice(-HISTORY_LIMIT),
        future: [],
        lastCreated: outcome.created,
        lastCloudSwitch: outcome.cloudSwitch ?? null,
      };
    }
  }
}
