import type { Shape } from '@/lib/domain';
import type { CanvasTheme } from '@/lib/design/tokens';

/**
 * Props every shape renderer accepts.
 *
 * `interaction` is omitted when the diagram is rendered for export or for an
 * embed, which is how exported files end up free of editor chrome instead of
 * having it stripped out of a cloned DOM node afterwards.
 */
export interface ShapeRenderProps {
  shape: Shape;
  theme: CanvasTheme;
  /** Resolves a shape id, needed to colour items by their zone. */
  lookup: (id: string) => Shape | undefined;
  /**
   * What the group holds, said in words, when the canvas is too far out to draw
   * it. Already translated: a shape renderer is also used by the exporter and
   * the embed, neither of which has a `t`. Absent means draw everything, which
   * is every case but a zoomed-out group of several services.
   */
  summary?: string;
  interaction?: ShapeInteraction;
}

export interface ShapeInteraction {
  selected: boolean;
  colliding: boolean;
  isConnectorSource: boolean;
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
  onClick?: (e: React.MouseEvent, id: string) => void;
  onDoubleClick?: (e: React.MouseEvent, id: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
}

/** Event handlers bound to a specific shape, or nothing when non-interactive. */
export function handlersFor(id: string, interaction?: ShapeInteraction) {
  if (!interaction) return { 'data-shape-id': id };
  return {
    'data-shape-id': id,
    onPointerDown: (e: React.PointerEvent) => interaction.onPointerDown?.(e, id),
    onClick: (e: React.MouseEvent) => interaction.onClick?.(e, id),
    onDoubleClick: (e: React.MouseEvent) => interaction.onDoubleClick?.(e, id),
    onContextMenu: (e: React.MouseEvent) => interaction.onContextMenu?.(e, id),
    style: { cursor: 'pointer' as const },
  };
}
