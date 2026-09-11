import { describe, expect, it } from 'vitest';
import type { DiagramModel } from '@/lib/domain';
import { isDecorative } from '@/lib/domain';
import { checkCollisions } from './collision';
import { bbox, geometricallyContains, rectsOverlap } from './geometry';
import { isRelated } from './model';
import { makeRng, modelWith } from './testUtils';

/**
 * The original O(n^2) implementation, kept here as the reference oracle.
 * The spatial-hash version in collision.ts must agree with it exactly.
 */
function naiveCollisions(model: DiagramModel): Set<string> {
  const bad = new Set<string>();
  const shapes = model.shapes;
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const A = shapes[i];
      const B = shapes[j];
      if (isRelated(model, A.id, B.id)) continue;
      if (isDecorative(A) || isDecorative(B)) continue;
      if (A.type === 'boundary' && geometricallyContains(bbox(A), bbox(B))) continue;
      if (B.type === 'boundary' && geometricallyContains(bbox(B), bbox(A))) continue;
      if (rectsOverlap(bbox(A), bbox(B))) {
        bad.add(A.id);
        bad.add(B.id);
      }
    }
  }
  return bad;
}

const sorted = (s: Set<string>) => [...s].sort();

describe('checkCollisions', () => {
  it('finds two overlapping unrelated shapes', () => {
    const m = modelWith([
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 50, y: 50, w: 100, h: 100 },
    ]);
    expect(sorted(checkCollisions(m))).toEqual(['a', 'b']);
  });

  it('ignores parent/child overlap', () => {
    const m = modelWith([
      { id: 'g', type: 'group', x: 0, y: 0, w: 200, h: 200 },
      { id: 'c', type: 'container', parentId: 'g', x: 10, y: 10, w: 100, h: 100 },
      { id: 'i', type: 'item', parentId: 'c', x: 20, y: 20, w: 50, h: 50 },
    ]);
    expect(checkCollisions(m).size).toBe(0);
  });

  it('lets a boundary contain unrelated shapes', () => {
    const m = modelWith([
      { id: 'bd', type: 'boundary', x: 0, y: 0, w: 500, h: 500 },
      { id: 'g', type: 'group', x: 50, y: 50, w: 100, h: 100 },
    ]);
    expect(checkCollisions(m).size).toBe(0);
  });

  it('still flags a shape straddling a boundary edge', () => {
    const m = modelWith([
      { id: 'bd', type: 'boundary', x: 0, y: 0, w: 200, h: 200 },
      { id: 'g', type: 'group', x: 150, y: 50, w: 100, h: 100 },
    ]);
    expect(sorted(checkCollisions(m))).toEqual(['bd', 'g']);
  });

  it('never flags decoration, over or under anything', () => {
    const m = modelWith([
      { id: 'rg', type: 'region', x: 0, y: 0, w: 500, h: 500 },
      { id: 'g', type: 'group', x: 400, y: 400, w: 200, h: 200 },
      { id: 'nt', type: 'note', x: 450, y: 450, w: 100, h: 100 },
      { id: 'tx', type: 'text', x: 0, y: 0, w: 200, h: 40 },
      { id: 'nt2', type: 'note', x: 10, y: 10, w: 100, h: 100 },
    ]);
    // The region straddles the group, the note sits on it, the two notes and
    // the text overlap each other: all of it is what decoration is for.
    expect(checkCollisions(m).size).toBe(0);
    expect(naiveCollisions(m).size).toBe(0);
  });

  it('reports nothing for a diagram laid out on a grid', () => {
    const shapes = [];
    for (let i = 0; i < 40; i++) {
      shapes.push({ id: `s${i}`, x: (i % 8) * 300, y: Math.floor(i / 8) * 300, w: 200, h: 200 });
    }
    expect(checkCollisions(modelWith(shapes)).size).toBe(0);
  });

  it('agrees with the exhaustive check on randomised diagrams', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = makeRng(seed);
      const n = 5 + Math.floor(rng() * 45);
      const shapes = Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        // A deliberately cramped canvas so overlaps are common.
        x: Math.floor(rng() * 1200),
        y: Math.floor(rng() * 900),
        w: 40 + Math.floor(rng() * 400),
        h: 40 + Math.floor(rng() * 300),
        type: (rng() < 0.15 ? 'boundary' : 'item') as 'boundary' | 'item',
      }));
      const m = modelWith(shapes);
      expect(sorted(checkCollisions(m)), `seed ${seed}`).toEqual(sorted(naiveCollisions(m)));
    }
  });

  it('agrees with the exhaustive check when shapes are far larger than one cell', () => {
    const rng = makeRng(99);
    const shapes = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      x: Math.floor(rng() * 3000),
      y: Math.floor(rng() * 2000),
      // Spans many 256px buckets, exercising the duplicate-pair guard.
      w: 800 + Math.floor(rng() * 1500),
      h: 600 + Math.floor(rng() * 1000),
    }));
    const m = modelWith(shapes);
    expect(sorted(checkCollisions(m))).toEqual(sorted(naiveCollisions(m)));
  });

  it('handles negative coordinates', () => {
    const m = modelWith([
      { id: 'a', x: -500, y: -400, w: 200, h: 200 },
      { id: 'b', x: -450, y: -350, w: 200, h: 200 },
      { id: 'c', x: 900, y: 900, w: 50, h: 50 },
    ]);
    expect(sorted(checkCollisions(m))).toEqual(['a', 'b']);
  });

  it('returns an empty set for an empty diagram', () => {
    expect(checkCollisions(modelWith([])).size).toBe(0);
  });
});
