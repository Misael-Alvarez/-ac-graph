import type { Connector, DiagramModel, Shape } from '@/lib/domain';
import { idPrefix, uid } from './ids';
import { collectDescendantIds } from './model';

export interface ClipboardPayload {
  shapes: Shape[];
  connectors: Connector[];
}

/** Deep-copies the given shapes plus all their descendants and internal connectors. */
export function cloneShapes(model: DiagramModel, ids: Set<string>): ClipboardPayload {
  const allIds = new Set<string>();
  for (const id of ids) {
    for (const d of collectDescendantIds(model, id)) allIds.add(d);
  }
  return {
    shapes: model.shapes.filter((s) => allIds.has(s.id)).map((s) => structuredClone(s)),
    connectors: model.connectors
      .filter((c) => allIds.has(c.sourceId) && allIds.has(c.targetId))
      .map((c) => structuredClone(c)),
  };
}

/** Inserts a clipboard payload at an offset, remapping every ID. Returns the new top-level IDs. */
export function pasteShapes(
  model: DiagramModel,
  data: ClipboardPayload,
  offsetX: number,
  offsetY: number,
): Set<string> {
  const idMap = new Map<string, string>();
  for (const s of data.shapes) idMap.set(s.id, uid(idPrefix(s.id)));

  for (const s of data.shapes) {
    const ns: Shape = {
      ...structuredClone(s),
      id: idMap.get(s.id)!,
      x: s.x + offsetX,
      y: s.y + offsetY,
    };
    if (ns.parentId && idMap.has(ns.parentId)) ns.parentId = idMap.get(ns.parentId)!;
    model.shapes.push(ns);
  }

  for (const c of data.connectors) {
    // Everything the line was — its words, its kind, its faces, its colour,
    // and a route of the author's — comes along; only the ids are new.
    model.connectors.push({
      ...structuredClone(c),
      id: uid('cn'),
      sourceId: idMap.get(c.sourceId) ?? c.sourceId,
      targetId: idMap.get(c.targetId) ?? c.targetId,
      waypoints: c.waypoints.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
    });
  }

  return new Set(data.shapes.map((s) => idMap.get(s.id)!));
}
