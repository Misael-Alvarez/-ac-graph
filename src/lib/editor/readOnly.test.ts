import { describe, expect, it, vi } from 'vitest';
import { createEmptyModel } from '@/lib/engine';
import type { EditorAction } from './actions';
import { allowedWhenReadOnly, guardDispatch } from './readOnly';

const model = createEmptyModel();

describe('read-only guard', () => {
  it('lets through only what the server sends', () => {
    expect(allowedWhenReadOnly({ type: 'load', model })).toBe(true);
    expect(allowedWhenReadOnly({ type: 'replaceModel', model, origin: 'remote' })).toBe(true);
    expect(allowedWhenReadOnly({ type: 'replaceModel', model })).toBe(false);
    expect(allowedWhenReadOnly({ type: 'replaceModel', model, origin: 'local' })).toBe(false);
    const edits: EditorAction[] = [
      { type: 'addGroup', x: 0, y: 0 },
      { type: 'deleteShapes', ids: ['a'] },
      { type: 'moveShapes', ids: ['a'], dx: 1, dy: 1, viewId: null },
      { type: 'setShapeProps', id: 'a', patch: { title: 'x' } },
      { type: 'addConnector', sourceId: 'a', targetId: 'b' },
      {
        type: 'setConnectorRoute',
        id: 'c',
        waypoints: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        viewId: null,
      },
      { type: 'resetConnectorRoute', id: 'c' },
      {
        type: 'setConnectorProps',
        id: 'c',
        patch: { sourcePort: 'N', labelAt: 0.7, color: '#ff9900' },
      },
      { type: 'autoLayout', viewId: null },
      { type: 'addView', name: 'v', from: null },
      { type: 'undo' },
      { type: 'redo' },
    ];
    for (const action of edits) expect(allowedWhenReadOnly(action)).toBe(false);
  });

  it('is the dispatcher itself when not read-only, and a filter when it is', () => {
    const dispatch = vi.fn();
    expect(guardDispatch(dispatch, false)).toBe(dispatch);

    const guarded = guardDispatch(dispatch, true);
    guarded({ type: 'deleteShapes', ids: ['a'] });
    guarded({ type: 'undo' });
    expect(dispatch).not.toHaveBeenCalled();
    guarded({ type: 'replaceModel', model, origin: 'remote' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
