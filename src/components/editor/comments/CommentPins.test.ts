import { describe, expect, it } from 'vitest';
import type { CommentThread } from '@/lib/domain';
import { addDecoration, addGroup, createEmptyModel } from '@/lib/engine';
import { draftPinAt, pinsFor } from './CommentPins';

const thread = (id: string, anchor: CommentThread['anchor'], resolved = false): CommentThread => ({
  id,
  diagramId: 'dgm_1',
  anchor,
  createdAt: '2026-09-10T10:00:00.000Z',
  resolvedAt: resolved ? '2026-09-10T11:00:00.000Z' : null,
  resolvedBy: resolved ? { id: 'u', name: 'U' } : null,
  comments: [{ id: `${id}-c`, author: { id: 'u', name: 'U' }, body: 'x', createdAt: 'T' }],
});

describe('pinsFor', () => {
  it('puts one pin with a count on a shape, at its top-right corner, following the shape', () => {
    const model = createEmptyModel();
    const group = addGroup(model, 100, 200);
    const pins = pinsFor(
      [
        thread('a', { shapeId: group.id, x: 0, y: 0 }),
        thread('b', { shapeId: group.id, x: 0, y: 0 }),
      ],
      model,
    );
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({
      x: group.x + group.w,
      y: group.y,
      count: 2,
      threadId: 'a',
      shapeId: group.id,
      detached: false,
    });
    group.x += 50;
    expect(pinsFor([thread('a', { shapeId: group.id, x: 0, y: 0 })], model)[0].x).toBe(
      group.x + group.w,
    );
  });

  it('pins a sheet thread where it was left, and a deleted shape\u2019s where the shape was', () => {
    const model = createEmptyModel();
    const pins = pinsFor(
      [
        thread('sheet', { shapeId: null, x: 40, y: 50 }),
        thread('gone', { shapeId: 'itm_gone', x: 300, y: 400 }),
      ],
      model,
    );
    expect(pins.find((p) => p.threadId === 'sheet')).toMatchObject({
      x: 40,
      y: 50,
      count: 1,
      shapeId: null,
      detached: false,
    });
    expect(pins.find((p) => p.threadId === 'gone')).toMatchObject({
      x: 300,
      y: 400,
      shapeId: null,
      detached: true,
    });
  });

  it('draws only what the caller passes: resolved threads are the caller\u2019s to leave out', () => {
    const model = createEmptyModel();
    const open = [thread('a', { shapeId: null, x: 1, y: 1 })];
    expect(pinsFor(open, model)).toHaveLength(1);
    expect(pinsFor([], model)).toEqual([]);
  });

  it('places a draft on its shape\u2019s corner, or at its point', () => {
    const model = createEmptyModel();
    const note = addDecoration(model, 'note', 10, 20);
    expect(draftPinAt({ shapeId: note.id, x: 0, y: 0 }, model)).toEqual({
      x: note.x + note.w,
      y: note.y,
    });
    expect(draftPinAt({ shapeId: null, x: 7, y: 8 }, model)).toEqual({ x: 7, y: 8 });
    expect(draftPinAt({ shapeId: 'nope', x: 7, y: 8 }, model)).toEqual({ x: 7, y: 8 });
  });
});
