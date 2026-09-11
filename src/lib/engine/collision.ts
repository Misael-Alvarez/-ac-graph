import type { BBox, DiagramModel, Shape } from '@/lib/domain';
import { isDecorative } from '@/lib/domain';
import { bbox, geometricallyContains, rectsOverlap } from './geometry';
import { isRelated } from './model';

/**
 * Uniform spatial hash.
 *
 * The original check compared every shape against every other one, so a 100-shape
 * diagram cost ~5000 comparisons on each pointer move. Bucketing by cell means
 * only shapes that share a cell are ever compared.
 */
const CELL = 256;

function cellsFor(b: BBox): string[] {
  const out: string[] = [];
  const x0 = Math.floor(b.x / CELL);
  const y0 = Math.floor(b.y / CELL);
  const x1 = Math.floor((b.x + b.w) / CELL);
  const y1 = Math.floor((b.y + b.h) / CELL);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push(`${x}:${y}`);
  }
  return out;
}

/** IDs of shapes that overlap an unrelated shape, highlighted in red by the editor. */
export function checkCollisions(model: DiagramModel): Set<string> {
  const bad = new Set<string>();
  const grid = new Map<string, Shape[]>();

  for (const s of model.shapes) {
    for (const key of cellsFor(bbox(s))) {
      const bucket = grid.get(key);
      if (bucket) bucket.push(s);
      else grid.set(key, [s]);
    }
  }

  const tested = new Set<string>();
  for (const bucket of grid.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const A = bucket[i];
        const B = bucket[j];
        // A pair can share several cells; only evaluate it once.
        const pairKey = A.id < B.id ? `${A.id}|${B.id}` : `${B.id}|${A.id}`;
        if (tested.has(pairKey)) continue;
        tested.add(pairKey);

        if (isRelated(model, A.id, B.id)) continue;
        // Decoration lies over or under the architecture by design: a note on a
        // group or a region behind one is the point, not a mistake.
        if (isDecorative(A) || isDecorative(B)) continue;
        // A boundary is a container by design: things sitting inside it are fine.
        if (A.type === 'boundary' && geometricallyContains(bbox(A), bbox(B))) continue;
        if (B.type === 'boundary' && geometricallyContains(bbox(B), bbox(A))) continue;
        if (rectsOverlap(bbox(A), bbox(B))) {
          bad.add(A.id);
          bad.add(B.id);
        }
      }
    }
  }
  return bad;
}
