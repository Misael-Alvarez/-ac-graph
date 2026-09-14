import type { DiagramModel, Shape } from '@/lib/domain';
import { isDecorative } from '@/lib/domain';
import type { CanvasTheme } from '@/lib/design/tokens';
import { ConnectorLayer, type ConnectorLayerProps } from './ConnectorLayer';
import {
  BoundaryShape,
  ContainerShape,
  GroupShape,
  ItemShape,
  NoteShape,
  RegionShape,
  TextShape,
  type ShapeInteraction,
  type ShapeRenderProps,
} from './shapes';

/**
 * Paint order: a region is a wash under everything; boundaries sit behind
 * groups, which sit behind their items; notes and texts are written on top.
 */
const PAINT_ORDER: Shape['type'][] = [
  'region',
  'boundary',
  'group',
  'container',
  'item',
  'note',
  'text',
];

const RENDERERS: Record<Shape['type'], (props: ShapeRenderProps) => React.ReactElement> = {
  region: RegionShape,
  boundary: BoundaryShape,
  group: GroupShape,
  container: ContainerShape,
  item: ItemShape,
  note: NoteShape,
  text: TextShape,
};

export interface DiagramSceneProps {
  model: DiagramModel;
  theme: CanvasTheme;
  /**
   * Draw groups of several services as one summarised card.
   *
   * Set by the canvas when the reader has zoomed far enough out that the item
   * text is no longer legible. Never set for an export or an embed, which are
   * read at whatever size the reader chooses and so must hold every detail.
   */
  collapsed?: boolean;
  /** Renders the summary line, so this component holds no copy of its own. */
  summaryLabel?: (count: number) => string;
  /** Omitted when rendering for export or an embed, which is what keeps
   *  selection outlines and resize handles out of the produced file. */
  interactionFor?: (shape: Shape) => ShapeInteraction | undefined;
  connectorInteraction?: Omit<ConnectorLayerProps, 'connectors' | 'theme'>;
}

/**
 * The diagram itself, with no editor chrome.
 *
 * Both the interactive canvas and the exporter render this same component, so an
 * exported file cannot drift from what the user sees on screen.
 */
export function DiagramScene({
  model,
  theme,
  collapsed,
  summaryLabel,
  interactionFor,
  connectorInteraction,
}: DiagramSceneProps) {
  const lookup = (id: string) => model.shapes.find((s) => s.id === id);

  /**
   * Groups worth summarising, and how many services each holds.
   *
   * Only those holding more than one: a group of one already *is* a single
   * card, so collapsing it would replace a service the reader recognises by its
   * icon with the words "1 service", which is strictly less information.
   */
  const summarised = new Map<string, number>();
  if (collapsed) {
    for (const group of model.shapes) {
      if (group.type !== 'group') continue;
      const container = model.shapes.find((s) => s.parentId === group.id);
      if (!container) continue;
      const count = model.shapes.filter((s) => s.parentId === container.id).length;
      if (count > 1) summarised.set(group.id, count);
    }
  }

  /** Whether a shape is inside a group that is currently drawn as a summary. */
  const hiddenByCollapse = (shape: Shape): boolean => {
    if (!summarised.size) return false;
    if (shape.type === 'container') return summarised.has(shape.parentId ?? '');
    if (shape.type !== 'item') return false;
    const container = shape.parentId ? lookup(shape.parentId) : undefined;
    return summarised.has(container?.parentId ?? '');
  };

  return (
    <>
      <g>
        {PAINT_ORDER.map((type) => {
          const layer = model.shapes.filter((s) => s.type === type && !hiddenByCollapse(s));
          // The decoration's layers exist only when there is decoration: a
          // diagram with no regions or notes — every one made before they
          // existed — keeps exactly the tree it had, so the style snapshots
          // and anything else that walks it are undisturbed.
          if (!layer.length && isDecorative({ type })) return null;
          return (
            <g key={type}>
              {layer.map((shape, index) => {
                const Renderer = RENDERERS[type];
                const count = summarised.get(shape.id);
                const rendered = (
                  <Renderer
                    shape={shape}
                    theme={theme}
                    lookup={lookup}
                    summary={count && summaryLabel ? summaryLabel(count) : undefined}
                    interaction={interactionFor?.(shape)}
                  />
                );
                // Only the interactive canvas animates: an export or an embed is
                // a still image, and a half-played animation would bake into it.
                // The stagger index lets the stylesheet let shapes arrive in
                // sequence rather than all at once.
                return interactionFor ? (
                  <g
                    key={shape.id}
                    className="shape-enter"
                    style={{ '--i': Math.min(index, 12) } as React.CSSProperties}
                  >
                    {rendered}
                  </g>
                ) : (
                  <g key={shape.id}>{rendered}</g>
                );
              })}
            </g>
          );
        })}
      </g>
      <ConnectorLayer connectors={model.connectors} theme={theme} {...connectorInteraction} />
    </>
  );
}
