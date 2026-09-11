import type { Connector, CustomIcon, DiagramModel, Shape } from '@/lib/domain';
import type { AlignEdge, ClipboardPayload, DecorationType, DistributeAxis } from '@/lib/engine';
import type { CloudTarget } from '@/data/cloudEquivalents';
import type { Locale } from '@/lib/i18n/messages';

/**
 * Lets a burst of small edits land in the history as one step.
 *
 * Two consecutive actions carrying the same key are merged into the previous
 * undo entry, so an arrow-key move of forty pixels or a label typed letter by
 * letter come back with one Cmd+Z, not forty. The caller owns the key: it is
 * what decides where one burst ends and the next begins — a new field focused,
 * a pause between key presses — and any action without a key, or with a
 * different one, breaks the chain.
 */
export interface Coalescable {
  coalesceKey?: string;
}

/**
 * Domain-level editor actions.
 *
 * Every mutation of the diagram goes through one of these. There is deliberately
 * no `setModel` action: a blanket replace would make undo history meaningless and
 * force the whole model to be cloned on every keystroke, which is what the
 * original editor did on each pointer move.
 */
export type EditorAction =
  /** Replaces the document wholesale and clears history (open, template, import). */
  | { type: 'load'; model: DiagramModel }
  /**
   * Replaces the content but keeps history, so a code edit stays undoable.
   * `origin: 'remote'` marks a revision that arrived from another editor: it is
   * already saved, so the autosave must not write it back.
   */
  | { type: 'replaceModel'; model: DiagramModel; origin?: 'local' | 'remote' }
  | { type: 'addBoundary'; x: number; y: number; variant: 'outer' | 'sub' }
  | {
      type: 'addGroup';
      x: number;
      y: number;
      service?: { key: string; label: string; description?: string; category: string };
    }
  | { type: 'addItem'; containerId: string }
  /** A region, a note or a free text: decoration, placed where the reader pressed. */
  | { type: 'addDecoration'; kind: DecorationType; x: number; y: number; id?: string }
  | { type: 'deleteShapes'; ids: string[] }
  /* Geometry uses the resolved view and optional drill scope, in one undo step. */
  | ({
      type: 'moveShapes';
      ids: string[];
      dx: number;
      dy: number;
      viewId: string | null;
      drillPath?: string[];
    } & Coalescable)
  | ({ type: 'resizeShape'; id: string; w: number; h: number; viewId: string | null } & Coalescable)
  | ({ type: 'setShapeProps'; id: string; patch: Partial<Shape> } & Coalescable)
  | { type: 'reorderItem'; id: string; dir: 1 | -1; viewId: string | null; drillPath?: string[] }
  | {
      type: 'alignShapes';
      ids: string[];
      edge: AlignEdge;
      viewId: string | null;
      drillPath?: string[];
    }
  | {
      type: 'distributeShapes';
      ids: string[];
      axis: DistributeAxis;
      viewId: string | null;
      drillPath?: string[];
    }
  | { type: 'bringToFront'; id: string }
  | { type: 'sendToBack'; id: string }
  | { type: 'addConnector'; sourceId: string; targetId: string }
  | { type: 'deleteConnector'; id: string }
  | { type: 'reverseConnector'; id: string }
  | ({ type: 'setConnectorProps'; id: string; patch: Partial<Connector> } & Coalescable)
  | { type: 'paste'; payload: ClipboardPayload; offsetX: number; offsetY: number }
  | { type: 'duplicateShapes'; ids: string[] }
  | { type: 'autoLayout'; viewId: string | null; drillPath?: string[] }
  /* `locale` because retargeting rewrites each shape's subtitle from the
     catalogue, and a subtitle is content: it must arrive in the author's
     language, not in whatever the library defaults to. */
  /* Views are content, so they live in the model and ride the same history,
     persistence and share path as everything else. */
  | { type: 'addView'; name: string; from: string | null }
  | { type: 'renameView'; id: string; name: string }
  | { type: 'deleteView'; id: string }
  | { type: 'setViewInclude'; id: string; include: string[] | null }
  | { type: 'switchCloud'; target: CloudTarget; locale: Locale }
  | { type: 'switchShapeCloud'; id: string; target: CloudTarget; locale: Locale }
  /* An icon of the author's own, embedded so the document carries it. */
  | { type: 'addCustomIcon'; icon: CustomIcon }
  | { type: 'undo' }
  | { type: 'redo' };

export type EditorDispatch = (action: EditorAction) => void;
