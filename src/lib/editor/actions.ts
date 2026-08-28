import type { Connector, DiagramModel, Shape } from '@/lib/domain';
import type { AlignEdge, ClipboardPayload, DistributeAxis } from '@/lib/engine';
import type { CloudTarget } from '@/data/cloudEquivalents';
import type { Locale } from '@/lib/i18n/messages';

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
  /** Replaces the content but keeps history, so a code edit stays undoable. */
  | { type: 'replaceModel'; model: DiagramModel }
  | { type: 'addBoundary'; x: number; y: number; variant: 'outer' | 'sub' }
  | {
      type: 'addGroup';
      x: number;
      y: number;
      service?: { key: string; label: string; description?: string; category: string };
    }
  | { type: 'addItem'; containerId: string }
  | { type: 'deleteShapes'; ids: string[] }
  | { type: 'moveShapes'; ids: string[]; dx: number; dy: number }
  | { type: 'resizeShape'; id: string; w: number; h: number }
  | { type: 'setShapeProps'; id: string; patch: Partial<Shape> }
  | { type: 'reorderItem'; id: string; dir: 1 | -1 }
  | { type: 'alignShapes'; ids: string[]; edge: AlignEdge }
  | { type: 'distributeShapes'; ids: string[]; axis: DistributeAxis }
  | { type: 'bringToFront'; id: string }
  | { type: 'sendToBack'; id: string }
  | { type: 'addConnector'; sourceId: string; targetId: string }
  | { type: 'deleteConnector'; id: string }
  | { type: 'reverseConnector'; id: string }
  | { type: 'setConnectorProps'; id: string; patch: Partial<Connector> }
  | { type: 'paste'; payload: ClipboardPayload; offsetX: number; offsetY: number }
  | { type: 'duplicateShapes'; ids: string[] }
  | { type: 'autoLayout' }
  /* `locale` because retargeting rewrites each shape's subtitle from the
     catalogue, and a subtitle is content: it must arrive in the author's
     language, not in whatever the library defaults to. */
  | { type: 'switchCloud'; target: CloudTarget; locale: Locale }
  | { type: 'switchShapeCloud'; id: string; target: CloudTarget; locale: Locale }
  | { type: 'undo' }
  | { type: 'redo' };

export type EditorDispatch = (action: EditorAction) => void;
