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
  /** Set when the entry may absorb the next action carrying the same key. */
  key?: string;
}

export interface DocState {
  model: DiagramModel;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** IDs created by the last action, so the UI can select them. */
  lastCreated: string[];
  /** Outcome of the last cloud switch, for the status toast. */
  lastCloudSwitch: SwitchCloudResult | null;
  /** The view the last action created, for the interface to select. */
  lastCreatedViewId: string | null;
  /**
   * Where the current model came from. `remote` means it was adopted from
   * another editor's confirmed save and is not a local edit: the autosave
   * skips it, or two editors would re-save each other's work in a loop.
   */
  origin: 'local' | 'remote';
}

export function initialDocState(model: DiagramModel): DocState {
  return {
    model,
    past: [],
    future: [],
    lastCreated: [],
    lastCloudSwitch: null,
    lastCreatedViewId: null,
    origin: 'local',
  };
}

export const canUndo = (s: DocState) => s.past.length > 0;
export const canRedo = (s: DocState) => s.future.length > 0;

interface ActionOutcome {
  /** IDs created by the action, so the UI can select them. */
  created: string[];
  /** Populated only by a cloud switch, for the status toast. */
  cloudSwitch?: SwitchCloudResult;
  /** A view the action created, so the interface can switch to it. */
  viewId?: string;
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
      // Views too. Compiling mints fresh shape ids, so keeping the old views
      // here would leave every one of them selecting and placing shapes that no
      // longer exist — the views would survive a code edit as empty names.
      //
      // But their *ids* are kept, matched by name. A view rebuilt from the
      // document gets an id derived from its slug, and swapping it in would make
      // the reader's own view vanish from under them on the keystroke that
      // recompiled — the interface points at an id that no longer exists and
      // falls back to the main view. Same trick as `diff.ts`: identity has to
      // survive a recompile, and the name is what survives it.
      // And the standards, for the same reason: they are part of the document,
      // so a code edit that dropped them would delete a team's rules the first
      // time anybody touched the architecture they guard.
      draft.rules = action.model.rules;
      // Uploaded icons ride along: a recompile from the code panel yields a
      // model that never knew them, and dropping them would blank every card
      // that wears one the moment somebody edits the YAML.
      if (action.model.customIcons?.length) draft.customIcons = action.model.customIcons;

      const idByName = new Map(draft.views.map((v) => [v.name, v.id]));
      draft.views = action.model.views.map((view) => {
        const existing = idByName.get(view.name);
        return existing && existing !== view.id ? { ...view, id: existing } : view;
      });
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
      E.editViewGeometry(draft, action.viewId, action.drillPath ?? [], (reading) => {
        E.applyMoves(
          reading,
          E.outermost(
            reading,
            action.ids.filter((id) => E.getShape(reading, id)),
          ).map((s) => ({ id: s.id, dx: action.dx, dy: action.dy })),
        );
      });
      return NOTHING;
    }

    case 'resizeShape': {
      E.editViewGeometry(draft, action.viewId, [], (reading) => {
        const shape = E.getShape(reading, action.id);
        if (!shape || (shape.w === action.w && shape.h === action.h)) return;
        shape.w = action.w;
        shape.h = action.h;
        shape.manualSize = true;
        if (shape.type === 'group') E.relayoutGroup(reading, shape);
      });
      return NOTHING;
    }

    case 'setShapeProps': {
      const shape = E.getShape(draft, action.id);
      if (!shape) return NOTHING;
      Object.assign(shape, action.patch);
      // Content edits are shared, but must not reset a view's arrangement.
      if (['x', 'y', 'w', 'h', 'manualSize'].some((key) => key in action.patch)) {
        if (shape.type === 'group') E.relayoutGroup(draft, shape);
        E.routeConnectorsFor(draft, E.collectDescendantIds(draft, action.id));
      }
      return NOTHING;
    }

    case 'alignShapes':
    case 'distributeShapes': {
      E.editViewGeometry(draft, action.viewId, action.drillPath ?? [], (reading) => {
        const ids = action.ids.filter((id) => E.getShape(reading, id));
        const moves =
          action.type === 'alignShapes'
            ? E.alignMoves(reading, ids, action.edge)
            : E.distributeMoves(reading, ids, action.axis);
        E.applyMoves(reading, moves);
      });
      return NOTHING;
    }

    case 'reorderItem': {
      E.editViewGeometry(draft, action.viewId, action.drillPath ?? [], (reading) => {
        const item = E.getShape(reading, action.id);
        if (!item?.parentId) return;
        const siblings = E.children(reading, item.parentId)
          .filter((s) => s.type === 'item')
          .sort((a, b) => a.y - b.y);
        const other = siblings[siblings.indexOf(item) + action.dir];
        if (!other) return;
        [item.y, other.y] = [other.y, item.y];
        [item.order, other.order] = [other.order, item.order];
      });
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
      // Unscoped callers must not silently rearrange the main view.
      if (action.viewId === undefined) return NOTHING;
      E.editViewGeometry(draft, action.viewId, action.drillPath ?? [], E.autoLayout);
      return NOTHING;
    }

    case 'addView': {
      const source = action.from ? draft.views.find((v) => v.id === action.from) : undefined;
      // The first explicit view has to record the main one too, or the model
      // would answer "views: [Security]" and lose the reading it already had.
      if (!draft.views.length) draft.views.push({ ...E.defaultView(), name: '' });
      const view = {
        id: E.newViewId(),
        name: action.name,
        kind: source?.kind ?? ('free' as const),
        ...(source?.include ? { include: [...source.include] } : {}),
        // Copied box by box, not with `structuredClone`: `source` is an Immer
        // draft, and a proxy is not cloneable.
        ...(source?.place
          ? {
              place: Object.fromEntries(
                Object.entries(source.place).map(([id, box]) => [id, { ...box }]),
              ),
            }
          : {}),
      };
      draft.views.push(view);
      return { created: [], viewId: view.id };
    }

    case 'renameView': {
      const view = draft.views.find((v) => v.id === action.id);
      if (view) view.name = action.name;
      return NOTHING;
    }

    case 'deleteView': {
      // The main view is the model's own reading of itself; there is no diagram
      // without it, so it is the one view that cannot be deleted.
      if (draft.views.length < 2 || draft.views[0].id === action.id) return NOTHING;
      draft.views = draft.views.filter((v) => v.id !== action.id);
      return NOTHING;
    }

    case 'setViewInclude': {
      const view = draft.views.find((v) => v.id === action.id);
      if (!view) return NOTHING;
      if (action.include) view.include = action.include;
      else delete view.include;
      return NOTHING;
    }

    case 'switchShapeCloud': {
      E.switchShapeCloud(draft, action.id, action.target, action.locale);
      return NOTHING;
    }

    case 'switchCloud': {
      return { created: [], cloudSwitch: E.switchCloud(draft, action.target, action.locale) };
    }

    case 'addCustomIcon': {
      const icons = draft.customIcons ?? [];
      const index = icons.findIndex((icon) => icon.key === action.icon.key);
      if (index >= 0) icons[index] = action.icon;
      else icons.push(action.icon);
      draft.customIcons = icons;
      return NOTHING;
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
        origin: 'local',
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
        origin: 'local',
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
          return {
            ...state,
            lastCreated: [],
            lastCloudSwitch: outcome.cloudSwitch,
            lastCreatedViewId: null,
            origin: 'local',
          };
        }
        return state;
      }
      const key = 'coalesceKey' in action ? action.coalesceKey : undefined;
      const previous = state.past.at(-1);
      // Patches are relative to the state they were recorded against, so a
      // merged entry replays them in order: the old redo then the new one, the
      // new undo then the old one.
      const entry: HistoryEntry =
        key !== undefined && previous?.key === key
          ? { key, redo: [...previous.redo, ...redo], undo: [...undo, ...previous.undo] }
          : { redo, undo, ...(key !== undefined ? { key } : {}) };
      const kept =
        key !== undefined && previous?.key === key ? state.past.slice(0, -1) : state.past;
      return {
        model,
        past: [...kept, entry].slice(-HISTORY_LIMIT),
        future: [],
        lastCreated: outcome.created,
        lastCloudSwitch: outcome.cloudSwitch ?? null,
        lastCreatedViewId: outcome.viewId ?? null,
        origin: action.type === 'replaceModel' && action.origin === 'remote' ? 'remote' : 'local',
      };
    }
  }
}
