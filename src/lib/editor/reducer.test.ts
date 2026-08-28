import { describe, expect, it } from 'vitest';
import { children, createEmptyModel, getShape, resolveView } from '@/lib/engine';
import type { EditorAction } from './actions';
import { canRedo, canUndo, docReducer, initialDocState, type DocState } from './reducer';

/** Applies a sequence of actions, mirroring how the UI dispatches them. */
function run(state: DocState, ...actions: EditorAction[]): DocState {
  return actions.reduce(docReducer, state);
}

/** A document that already contains one group, with an empty history. */
function withOneGroup() {
  const seeded = run(initialDocState(createEmptyModel()), { type: 'addGroup', x: 100, y: 100 });
  const state = run(seeded, { type: 'load', model: seeded.model });
  const group = state.model.shapes.find((sh) => sh.type === 'group')!;
  return { state, groupId: group.id };
}

describe('creation', () => {
  it('adds a group with its container and item', () => {
    const state = run(initialDocState(createEmptyModel()), { type: 'addGroup', x: 100, y: 100 });
    expect(state.model.shapes).toHaveLength(3);
    expect(state.lastCreated).toHaveLength(3);
  });

  it('colours a group dropped from the palette by provider', () => {
    const state = run(initialDocState(createEmptyModel()), {
      type: 'addGroup',
      x: 0,
      y: 0,
      service: { key: 'aws-lambda', label: 'Lambda', description: 'Serverless', category: 'aws' },
    });
    const group = state.model.shapes.find((s) => s.type === 'group')!;
    const item = state.model.shapes.find((s) => s.type === 'item')!;
    expect(group.title).toBe('Lambda');
    expect(group.fill).toBe('#fff8f0');
    expect(item.icon).toEqual({ kind: 'symbol', key: 'aws-lambda' });
    expect(item.subtitle).toBe('Serverless');
  });

  it('adds a boundary and reports its id', () => {
    const state = run(initialDocState(createEmptyModel()), {
      type: 'addBoundary',
      x: 0,
      y: 0,
      variant: 'outer',
    });
    expect(state.lastCreated).toHaveLength(1);
    expect(getShape(state.model, state.lastCreated[0])!.type).toBe('boundary');
  });
});

describe('undo / redo', () => {
  it('starts with nothing to undo', () => {
    const s = initialDocState(createEmptyModel());
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });

  it('undoes a drag in a single step and restores the exact position', () => {
    // This is the regression the old editor had: its drag handler pushed the
    // already-moved model onto the history, so Ctrl+Z was a no-op.
    const { state, groupId } = withOneGroup();
    const before = getShape(state.model, groupId)!;
    const origin = { x: before.x, y: before.y };

    const moved = run(state, {
      type: 'moveShapes',
      ids: [groupId],
      dx: 250,
      dy: -60,
      viewId: null,
    });
    expect(getShape(moved.model, groupId)).toMatchObject({ x: origin.x + 250, y: origin.y - 60 });

    const undone = run(moved, { type: 'undo' });
    expect(getShape(undone.model, groupId)).toMatchObject(origin);
    expect(canUndo(undone)).toBe(false);
  });

  it('redoes what it just undid', () => {
    const { state, groupId } = withOneGroup();
    const moved = run(state, {
      type: 'moveShapes',
      ids: [groupId],
      dx: 100,
      dy: 100,
      viewId: null,
    });
    const redone = run(moved, { type: 'undo' }, { type: 'redo' });
    expect(getShape(redone.model, groupId)).toMatchObject(getShape(moved.model, groupId)!);
  });

  it('undoes a resize back to the original size', () => {
    const { state, groupId } = withOneGroup();
    const original = { w: getShape(state.model, groupId)!.w, h: getShape(state.model, groupId)!.h };

    const resized = run(state, { type: 'resizeShape', id: groupId, w: 800, h: 500, viewId: null });
    expect(getShape(resized.model, groupId)!.w).toBe(800);

    const undone = run(resized, { type: 'undo' });
    expect(getShape(undone.model, groupId)).toMatchObject(original);
  });

  it('walks back through a long history', () => {
    let state = withOneGroup().state;
    const groupId = state.model.shapes.find((s) => s.type === 'group')!.id;
    for (let i = 0; i < 20; i++) {
      state = run(state, { type: 'moveShapes', ids: [groupId], dx: 10, dy: 0, viewId: null });
    }
    expect(getShape(state.model, groupId)!.x).toBe(300);
    for (let i = 0; i < 20; i++) state = run(state, { type: 'undo' });
    expect(getShape(state.model, groupId)!.x).toBe(100);
    expect(canUndo(state)).toBe(false);
  });

  it('drops the redo stack once new work happens', () => {
    const { state, groupId } = withOneGroup();
    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 50, dy: 0, viewId: null });
    const undone = run(moved, { type: 'undo' });
    expect(canRedo(undone)).toBe(true);

    const diverged = run(undone, {
      type: 'moveShapes',
      ids: [groupId],
      dx: -50,
      dy: 0,
      viewId: null,
    });
    expect(canRedo(diverged)).toBe(false);
  });

  it('restores deleted shapes and their connectors', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addGroup', x: 0, y: 0 }, { type: 'addGroup', x: 900, y: 0 });
    const items = state.model.shapes.filter((s) => s.type === 'item');
    state = run(state, { type: 'addConnector', sourceId: items[0].id, targetId: items[1].id });
    const full = state.model;

    state = run(state, { type: 'deleteShapes', ids: [items[0].parentId!] });
    expect(state.model.connectors).toHaveLength(0);

    state = run(state, { type: 'undo' });
    expect(state.model.shapes).toHaveLength(full.shapes.length);
    expect(state.model.connectors).toHaveLength(1);
  });

  it('ignores an action that changes nothing', () => {
    const { state } = withOneGroup();
    const after = run(state, { type: 'deleteShapes', ids: ['ghost'] });
    expect(after).toBe(state);
    expect(after.past).toHaveLength(state.past.length);
  });

  it('undo and redo on an empty history are no-ops', () => {
    const s = initialDocState(createEmptyModel());
    expect(run(s, { type: 'undo' })).toBe(s);
    expect(run(s, { type: 'redo' })).toBe(s);
  });

  it('clears history when a document is loaded', () => {
    const { state: seeded, groupId } = withOneGroup();
    const state = run(seeded, { type: 'moveShapes', ids: [groupId], dx: 10, dy: 0, viewId: null });
    expect(canUndo(state)).toBe(true);
    const loaded = run(state, { type: 'load', model: createEmptyModel() });
    expect(canUndo(loaded)).toBe(false);
    expect(loaded.model.shapes).toHaveLength(0);
  });
});

describe('moveShapes', () => {
  it('carries descendants along', () => {
    const { state, groupId } = withOneGroup();
    const item = state.model.shapes.find((s) => s.type === 'item')!;
    const offset = { x: item.x - 100, y: item.y - 100 };

    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 40, dy: 40, viewId: null });
    const movedItem = getShape(moved.model, item.id)!;
    expect(movedItem.x).toBe(140 + offset.x);
    expect(movedItem.y).toBe(140 + offset.y);
  });

  it('does not double-shift a descendant that is also selected', () => {
    const { state, groupId } = withOneGroup();
    const container = children(state.model, groupId)[0];
    const item = children(state.model, container.id)[0];
    const startX = item.x;

    const moved = run(state, {
      type: 'moveShapes',
      viewId: null,
      ids: [groupId, container.id, item.id],
      dx: 30,
      dy: 0,
    });
    expect(getShape(moved.model, item.id)!.x).toBe(startX + 30);
  });

  it('reroutes the connectors it touches and leaves the rest alone', () => {
    let state = initialDocState(createEmptyModel());
    state = run(
      state,
      { type: 'addGroup', x: 0, y: 0 },
      { type: 'addGroup', x: 900, y: 0 },
      { type: 'addGroup', x: 0, y: 800 },
      { type: 'addGroup', x: 900, y: 800 },
    );
    const items = state.model.shapes.filter((s) => s.type === 'item');
    state = run(
      state,
      { type: 'addConnector', sourceId: items[0].id, targetId: items[1].id },
      { type: 'addConnector', sourceId: items[2].id, targetId: items[3].id },
    );
    const untouchedBefore = structuredClone(state.model.connectors[1].waypoints);

    const moved = run(state, {
      type: 'moveShapes',
      ids: [items[0].parentId!],
      dx: 0,
      dy: 120,
      viewId: null,
    });

    expect(moved.model.connectors[0].waypoints).not.toEqual(state.model.connectors[0].waypoints);
    expect(moved.model.connectors[1].waypoints).toEqual(untouchedBefore);
  });

  it('ignores unknown ids', () => {
    const { state } = withOneGroup();
    expect(run(state, { type: 'moveShapes', ids: ['ghost'], dx: 10, dy: 10, viewId: null })).toBe(
      state,
    );
  });
});

describe('shape properties', () => {
  it('patches a shape and keeps the rest intact', () => {
    const { state } = withOneGroup();
    const item = state.model.shapes.find((s) => s.type === 'item')!;
    const patched = run(state, { type: 'setShapeProps', id: item.id, patch: { title: 'API' } });
    expect(getShape(patched.model, item.id)!.title).toBe('API');
    expect(getShape(patched.model, item.id)!.subtitle).toBe(item.subtitle);
  });

  it('reorders stacked items', () => {
    const { state, groupId } = withOneGroup();
    const container = children(state.model, groupId)[0];
    const withTwo = run(state, { type: 'addItem', containerId: container.id });
    const [first, second] = children(withTwo.model, container.id)
      .filter((s) => s.type === 'item')
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const reordered = run(withTwo, { type: 'reorderItem', id: second.id, dir: -1 });
    expect(getShape(reordered.model, second.id)!.y).toBeLessThan(
      getShape(reordered.model, first.id)!.y,
    );
  });

  it('moves a shape to the front and to the back of the paint order', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addBoundary', x: 0, y: 0, variant: 'outer' });
    const first = state.lastCreated[0];
    state = run(state, { type: 'addBoundary', x: 50, y: 50, variant: 'sub' });

    const front = run(state, { type: 'bringToFront', id: first });
    expect(front.model.shapes.at(-1)!.id).toBe(first);

    const back = run(front, { type: 'sendToBack', id: first });
    expect(back.model.shapes[0].id).toBe(first);
  });
});

describe('connectors', () => {
  it('creates, labels and deletes a connector', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addGroup', x: 0, y: 0 }, { type: 'addGroup', x: 900, y: 0 });
    const items = state.model.shapes.filter((s) => s.type === 'item');

    state = run(state, { type: 'addConnector', sourceId: items[0].id, targetId: items[1].id });
    const connId = state.lastCreated[0];
    expect(state.model.connectors).toHaveLength(1);

    state = run(state, {
      type: 'setConnectorProps',
      id: connId,
      patch: { label: 'invoke', style: 'dashed' },
    });
    expect(state.model.connectors[0]).toMatchObject({ label: 'invoke', style: 'dashed' });

    state = run(state, { type: 'deleteConnector', id: connId });
    expect(state.model.connectors).toHaveLength(0);
  });
});

describe('clipboard and layout', () => {
  it('pastes a copy and reports the new ids', () => {
    const { state, groupId } = withOneGroup();
    const payload = {
      shapes: state.model.shapes.map((s) => structuredClone(s)),
      connectors: [],
    };
    const pasted = run(state, { type: 'paste', payload, offsetX: 40, offsetY: 40 });

    expect(pasted.model.shapes).toHaveLength(6);
    expect(pasted.lastCreated).toHaveLength(3);
    expect(pasted.lastCreated).not.toContain(groupId);
  });

  it('runs auto-layout as one undoable step', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addGroup', x: 1500, y: 1200 });
    const before = { ...state.model.shapes.find((s) => s.type === 'group')! };

    const laid = run(state, { type: 'autoLayout' });
    expect(laid.model.shapes.find((s) => s.type === 'group')!.x).not.toBe(before.x);

    const undone = run(laid, { type: 'undo' });
    expect(undone.model.shapes.find((s) => s.type === 'group')!.x).toBe(before.x);
  });
});

describe('cloud switching', () => {
  it('switches the whole diagram and reports the outcome', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, {
      type: 'addGroup',
      x: 0,
      y: 0,
      service: { key: 'aws-lambda', label: 'Lambda', category: 'aws' },
    });

    const switched = run(state, { type: 'switchCloud', target: 'gcp', locale: 'en' });
    expect(switched.model.shapes.find((s) => s.type === 'item')!.icon!.key).toBe(
      'gcp-cloudfunctions',
    );
    expect(switched.lastCloudSwitch).toMatchObject({ switched: 1, skipped: [] });
  });

  it('reports services that have no equivalent', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, {
      type: 'addGroup',
      x: 0,
      y: 0,
      service: { key: 'aws-neptune', label: 'Neptune', category: 'aws' },
    });
    const switched = run(state, { type: 'switchCloud', target: 'gcp', locale: 'en' });
    expect(switched.lastCloudSwitch).toMatchObject({ switched: 0, skipped: ['Neptune'] });
  });

  it('switches a single shape', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, {
      type: 'addGroup',
      x: 0,
      y: 0,
      service: { key: 'aws-s3', label: 'S3', category: 'aws' },
    });
    const item = state.model.shapes.find((s) => s.type === 'item')!;

    const switched = run(state, {
      type: 'switchShapeCloud',
      id: item.id,
      target: 'azure',
      locale: 'en',
    });
    expect(getShape(switched.model, item.id)!.icon!.key).toBe('az-blob');
  });

  it('clears the cloud-switch notice on the next action', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, {
      type: 'addGroup',
      x: 0,
      y: 0,
      service: { key: 'aws-lambda', label: 'Lambda', category: 'aws' },
    });
    state = run(state, { type: 'switchCloud', target: 'gcp', locale: 'en' });
    expect(state.lastCloudSwitch).not.toBeNull();

    state = run(state, { type: 'addGroup', x: 500, y: 0 });
    expect(state.lastCloudSwitch).toBeNull();
  });
});

describe('immutability', () => {
  it('never mutates the previous state', () => {
    const { state, groupId } = withOneGroup();
    const snapshot = structuredClone(state.model);
    run(state, { type: 'moveShapes', ids: [groupId], dx: 99, dy: 99, viewId: null });
    expect(state.model).toEqual(snapshot);
  });

  it('shares untouched shapes between versions', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addGroup', x: 0, y: 0 }, { type: 'addGroup', x: 900, y: 0 });
    const untouched = state.model.shapes.find((s) => s.type === 'boundary' || s.type === 'group')!;
    const otherGroupId = state.model.shapes.filter((s) => s.type === 'group')[1].id;

    const moved = run(state, {
      type: 'moveShapes',
      ids: [otherGroupId],
      dx: 10,
      dy: 0,
      viewId: null,
    });
    // Structural sharing is what keeps large diagrams cheap to update.
    expect(moved.model.shapes.find((s) => s.id === untouched.id)).toBe(untouched);
  });
});

describe('duplicateShapes', () => {
  it('copies the selection and leaves the original alone', () => {
    const { state, groupId } = withOneGroup();
    const duplicated = run(state, { type: 'duplicateShapes', ids: [groupId] });

    expect(duplicated.model.shapes).toHaveLength(6);
    expect(getShape(duplicated.model, groupId)).toBeDefined();
    expect(duplicated.lastCreated).toHaveLength(3);
  });

  it('offsets the copy so it is visible', () => {
    const { state, groupId } = withOneGroup();
    const duplicated = run(state, { type: 'duplicateShapes', ids: [groupId] });
    const copyId = duplicated.lastCreated.find((id) => id.startsWith('grp'))!;

    const original = getShape(duplicated.model, groupId)!;
    const copy = getShape(duplicated.model, copyId)!;
    expect(copy.x).toBe(original.x + 40);
    expect(copy.y).toBe(original.y + 40);
  });

  it('carries the whole subtree, not just the top shape', () => {
    const { state, groupId } = withOneGroup();
    const duplicated = run(state, { type: 'duplicateShapes', ids: [groupId] });
    const copyId = duplicated.lastCreated.find((id) => id.startsWith('grp'))!;

    const container = children(duplicated.model, copyId);
    expect(container).toHaveLength(1);
    expect(children(duplicated.model, container[0].id)).toHaveLength(1);
  });

  it('duplicates several shapes at once', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addGroup', x: 0, y: 0 }, { type: 'addGroup', x: 900, y: 0 });
    const groups = state.model.shapes.filter((s) => s.type === 'group').map((s) => s.id);

    const duplicated = run(state, { type: 'duplicateShapes', ids: groups });
    expect(duplicated.model.shapes.filter((s) => s.type === 'group')).toHaveLength(4);
  });

  it('is a single undo step', () => {
    const { state, groupId } = withOneGroup();
    const duplicated = run(state, { type: 'duplicateShapes', ids: [groupId] });
    const undone = run(duplicated, { type: 'undo' });
    expect(undone.model.shapes).toHaveLength(3);
  });

  it('does nothing for an empty or unknown selection', () => {
    const { state } = withOneGroup();
    expect(run(state, { type: 'duplicateShapes', ids: [] })).toBe(state);
    expect(run(state, { type: 'duplicateShapes', ids: ['ghost'] })).toBe(state);
  });
});

describe('alignment', () => {
  function twoApart() {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addGroup', x: 100, y: 100 }, { type: 'addGroup', x: 800, y: 500 });
    const seeded = run(state, { type: 'load', model: state.model });
    return {
      state: seeded,
      ids: seeded.model.shapes.filter((s) => s.type === 'group').map((s) => s.id),
    };
  }

  it('aligns and stays undoable in one step', () => {
    const { state, ids } = twoApart();
    const aligned = run(state, { type: 'alignShapes', ids, edge: 'left' });
    const xs = aligned.model.shapes.filter((s) => s.type === 'group').map((s) => s.x);
    expect(new Set(xs).size).toBe(1);

    const undone = run(aligned, { type: 'undo' });
    expect(
      new Set(undone.model.shapes.filter((s) => s.type === 'group').map((s) => s.x)).size,
    ).toBe(2);
  });

  it('moves each group together with its contents', () => {
    const { state, ids } = twoApart();
    const before = state.model.shapes.find((s) => s.type === 'item' && s.x > 700)!;
    const aligned = run(state, { type: 'alignShapes', ids, edge: 'left' });
    const after = getShape(aligned.model, before.id)!;
    expect(after.x).toBeLessThan(before.x);
  });

  it('does nothing with fewer than two shapes', () => {
    const { state, ids } = twoApart();
    expect(run(state, { type: 'alignShapes', ids: [ids[0]], edge: 'left' })).toBe(state);
  });

  it('spaces three shapes evenly', () => {
    let state = initialDocState(createEmptyModel());
    state = run(
      state,
      { type: 'addGroup', x: 0, y: 0 },
      { type: 'addGroup', x: 700, y: 0 },
      { type: 'addGroup', x: 1800, y: 0 },
    );
    const ids = state.model.shapes.filter((s) => s.type === 'group').map((s) => s.id);

    const spaced = run(state, { type: 'distributeShapes', ids, axis: 'horizontal' });
    const groups = spaced.model.shapes.filter((s) => s.type === 'group').sort((a, b) => a.x - b.x);
    expect(groups[1].x - (groups[0].x + groups[0].w)).toBeCloseTo(
      groups[2].x - (groups[1].x + groups[1].w),
    );
  });
});

describe('reverseConnector', () => {
  it('swaps the endpoints and reroutes', () => {
    let state = initialDocState(createEmptyModel());
    state = run(state, { type: 'addGroup', x: 0, y: 0 }, { type: 'addGroup', x: 0, y: 800 });
    const items = state.model.shapes.filter((s) => s.type === 'item');
    state = run(state, { type: 'addConnector', sourceId: items[0].id, targetId: items[1].id });
    const before = state.model.connectors[0];

    const reversed = run(state, { type: 'reverseConnector', id: before.id });
    const after = reversed.model.connectors[0];
    expect(after.sourceId).toBe(before.targetId);
    expect(after.targetId).toBe(before.sourceId);
    expect(after.waypoints).not.toEqual(before.waypoints);
  });

  it('ignores an unknown connector', () => {
    const { state } = withOneGroup();
    expect(run(state, { type: 'reverseConnector', id: 'ghost' })).toBe(state);
  });
});

describe('views', () => {
  /** A document with one group and a second view selected. */
  function withSecondView() {
    const { state, groupId } = withOneGroup();
    const added = run(state, { type: 'addView', name: 'Seguridad', from: null });
    return { state: added, groupId, viewId: added.lastCreatedViewId! };
  }

  it('records the main view when the first explicit one is added', () => {
    const { state } = withSecondView();
    // Otherwise the model would answer "views: [Seguridad]" and lose the reading
    // it already had, which is the whole diagram.
    expect(state.model.views).toHaveLength(2);
    expect(state.model.views[0].id).toBe('view_main');
  });

  it('moving in the main view moves the shape, as it always did', () => {
    const { state, groupId } = withOneGroup();
    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 40, dy: 0, viewId: null });

    expect(getShape(moved.model, groupId)!.x).toBe(140);
    expect(moved.model.views).toHaveLength(0);
  });

  it('moving in another view writes a placement and leaves the shape alone', () => {
    const { state, groupId, viewId } = withSecondView();
    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 40, dy: 0, viewId });

    expect(getShape(moved.model, groupId)!.x).toBe(100);
    expect(moved.model.views[1].place?.[groupId]).toMatchObject({ x: 140 });
  });

  it('so the same shape sits in two places at once', () => {
    const { state, groupId, viewId } = withSecondView();
    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 300, dy: 0, viewId });

    const inMain = resolveView(moved.model, null).shapes.find((s) => s.id === groupId)!;
    const inOther = resolveView(moved.model, viewId).shapes.find((s) => s.id === groupId)!;
    expect(inMain.x).toBe(100);
    expect(inOther.x).toBe(400);
  });

  it('a second move in a view accumulates on the first', () => {
    const { state, groupId, viewId } = withSecondView();
    const twice = run(
      state,
      { type: 'moveShapes', ids: [groupId], dx: 40, dy: 0, viewId },
      { type: 'moveShapes', ids: [groupId], dx: 10, dy: 5, viewId },
    );
    expect(twice.model.views[1].place?.[groupId]).toMatchObject({ x: 150, y: 105 });
  });

  it('undoes a per-view move like any other edit', () => {
    const { state, groupId, viewId } = withSecondView();
    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 40, dy: 0, viewId });
    expect(canUndo(moved)).toBe(true);

    const back = run(moved, { type: 'undo' });
    expect(back.model.views[1].place?.[groupId]).toBeUndefined();
  });

  it('resizes per view too', () => {
    const { state, groupId, viewId } = withSecondView();
    const before = getShape(state.model, groupId)!.w;
    const resized = run(state, { type: 'resizeShape', id: groupId, w: 999, h: 42, viewId });

    expect(getShape(resized.model, groupId)!.w).toBe(before);
    expect(resized.model.views[1].place?.[groupId]).toMatchObject({ w: 999, h: 42 });
  });

  it('copies the source view when duplicating one', () => {
    const { state, groupId, viewId } = withSecondView();
    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 40, dy: 0, viewId });
    const copied = run(moved, { type: 'addView', name: 'Copia', from: viewId });

    expect(copied.model.views[2].place?.[groupId]).toMatchObject({ x: 140 });
    // A copy, not a share: moving in one must not move the other.
    const after = run(copied, {
      type: 'moveShapes',
      ids: [groupId],
      dx: 10,
      dy: 0,
      viewId: copied.lastCreatedViewId!,
    });
    expect(after.model.views[1].place?.[groupId]).toMatchObject({ x: 140 });
    expect(after.model.views[2].place?.[groupId]).toMatchObject({ x: 150 });
  });

  it('renames and deletes a view', () => {
    const { state, viewId } = withSecondView();
    expect(run(state, { type: 'renameView', id: viewId, name: 'PCI' }).model.views[1].name).toBe(
      'PCI',
    );
    expect(run(state, { type: 'deleteView', id: viewId }).model.views).toHaveLength(1);
  });

  it('refuses to delete the main view, which is the diagram itself', () => {
    const { state } = withSecondView();
    const after = run(state, { type: 'deleteView', id: 'view_main' });
    expect(after.model.views).toHaveLength(2);
  });

  it('narrows a view and widens it again', () => {
    const { state, groupId, viewId } = withSecondView();
    const narrowed = run(state, { type: 'setViewInclude', id: viewId, include: [groupId] });
    expect(narrowed.model.views[1].include).toEqual([groupId]);

    const widened = run(narrowed, { type: 'setViewInclude', id: viewId, include: null });
    expect(widened.model.views[1].include).toBeUndefined();
  });

  it('forgets a deleted shape everywhere, so no view selects a ghost', () => {
    const { state, groupId, viewId } = withSecondView();
    const prepared = run(
      state,
      { type: 'setViewInclude', id: viewId, include: [groupId] },
      { type: 'moveShapes', ids: [groupId], dx: 40, dy: 0, viewId },
    );

    const deleted = run(prepared, { type: 'deleteShapes', ids: [groupId] });
    expect(deleted.model.views[1].include).toEqual([]);
    expect(deleted.model.views[1].place).toEqual({});
  });
});

describe('replacing the model from the code panel', () => {
  it('takes the compiled views, not the ones built against dead ids', () => {
    const { state, groupId, viewId } = (() => {
      const { state, groupId } = withOneGroup();
      const added = run(state, { type: 'addView', name: 'Seguridad', from: null });
      return { state: added, groupId, viewId: added.lastCreatedViewId! };
    })();
    const moved = run(state, { type: 'moveShapes', ids: [groupId], dx: 40, dy: 0, viewId });

    // What a recompile hands back: the same architecture, every shape new.
    const recompiled = createEmptyModel();
    recompiled.views = [
      { id: 'view_main', name: '', kind: 'free' },
      { id: 'view_seguridad', name: 'Seguridad', kind: 'free' },
    ];

    const after = run(moved, { type: 'replaceModel', model: recompiled });
    // The stale placement is gone rather than left pointing at a deleted shape.
    expect(after.model.views[1].place).toBeUndefined();
    // But the id is the one the interface is pointing at, matched by name, so
    // the reader is not thrown back to the main view by their own keystroke.
    expect(after.model.views[1].id).toBe(viewId);
    expect(after.model.views[0].id).toBe('view_main');
  });

  it('takes a genuinely new view’s own id', () => {
    const { state } = withOneGroup();
    const recompiled = createEmptyModel();
    recompiled.views = [{ id: 'view_pci', name: 'PCI', kind: 'free' }];

    const after = run(state, { type: 'replaceModel', model: recompiled });
    expect(after.model.views[0].id).toBe('view_pci');
  });
});

describe('the standards a document declares', () => {
  const RULE = {
    id: 'own',
    description: 'Everything has an owner.',
    severity: 'high' as const,
    services: {},
    require: { owner: true },
  };

  it('survives a recompile from the code panel', () => {
    // They are part of the document, so a code edit that dropped them would
    // delete a team's rules the first time anybody touched the architecture.
    const { state } = withOneGroup();
    const recompiled = createEmptyModel();
    recompiled.rules = [RULE];

    const after = run(state, { type: 'replaceModel', model: recompiled });
    expect(after.model.rules).toEqual([RULE]);
  });

  it('goes away when the document no longer declares any', () => {
    const { state } = withOneGroup();
    const withRules = run(state, {
      type: 'replaceModel',
      model: { ...createEmptyModel(), rules: [RULE] },
    });
    const without = run(withRules, { type: 'replaceModel', model: createEmptyModel() });
    expect(without.model.rules).toBeUndefined();
  });
});
