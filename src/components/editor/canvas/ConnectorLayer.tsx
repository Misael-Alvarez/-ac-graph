import type { Connector } from '@/lib/domain';
import type { CanvasTheme } from '@/lib/design/tokens';
import { fontSize, fontWeight, isColor } from '@/lib/design/tokens';
import { labelAnchor, positionAlong, waypointsToPath } from '@/lib/editor/connectorPath';
import {
  arrowheadIdFor,
  badgeWidth,
  connectorLabel,
  connectorTags,
  strokeFor,
  toneColors,
} from '@/lib/editor/meta';

export interface ConnectorLayerProps {
  connectors: Connector[];
  theme: CanvasTheme;
  selectedId?: string | null;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
  onClick?: (e: React.MouseEvent, id: string) => void;
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
  onDoubleClick?: (e: React.MouseEvent, id: string) => void;
  onLabelPointerDown?: (e: React.PointerEvent, id: string) => void;
  onLabelKeyDown?: (e: React.KeyboardEvent, id: string) => void;
  labelPositionName?: string;
}

const LABEL_H = 20;
const LABEL_PAD = 10;
/** The tags beside the label: what the call carries, how it is authenticated. */
const TAG_H = 15;
const TAG_FONT = 8.5;
const TAG_GAP = 4;

/**
 * The arrows.
 *
 * A selected connector gets a soft halo underneath and a second, dashed stroke
 * on top that the stylesheet sets in motion — the dashes travel from source to
 * target, so the direction of the call is something the eye sees rather than
 * infers from a small arrowhead. Exports never carry the flow stroke: it is an
 * interaction cue, and a still image has nothing to animate.
 */
export function ConnectorLayer({
  connectors,
  theme,
  selectedId,
  onContextMenu,
  onClick,
  onPointerDown,
  onDoubleClick,
  onLabelPointerDown,
  onLabelKeyDown,
  labelPositionName,
}: ConnectorLayerProps) {
  const interactive = Boolean(onContextMenu || onClick);
  return (
    <g>
      {connectors.map((c) => {
        const d = waypointsToPath(c.waypoints, c.curve === 'orthogonal' ? 0 : undefined);
        if (!d) return null;
        // What the chip says: the label, or the protocol when there is none.
        const label = connectorLabel(c);
        const tags = connectorTags(c);
        const anchor = label || tags.length ? labelAnchor(c.waypoints, c.labelAt) : null;
        const selected = selectedId === c.id;
        const ownColor = isColor(c.color) ? c.color : undefined;
        const color = ownColor ?? (selected ? theme.titleText : theme.connector);
        const marker = ownColor
          ? arrowheadIdFor(ownColor)
          : selected
            ? 'arrowhead-ink'
            : 'arrowhead';
        const stroke = strokeFor(c);
        // Rough advance width; the label chip only has to look balanced.
        const labelWidth = label ? label.length * 6.2 + LABEL_PAD * 2 : 0;
        const tagsWidth = tags.reduce((sum, t) => sum + badgeWidth(t.text, TAG_FONT) + TAG_GAP, 0);
        // Label and tags are one centred cluster on the arrow's midpoint.
        const clusterWidth =
          labelWidth + (label && tags.length ? TAG_GAP : 0) + Math.max(tagsWidth - TAG_GAP, 0);
        const labelX = anchor ? anchor.x - clusterWidth / 2 : 0;
        let nextX = labelX + (label ? labelWidth + TAG_GAP : 0);
        const placedTags = tags.map((tag) => {
          const w = badgeWidth(tag.text, TAG_FONT);
          const x = nextX;
          nextX += w + TAG_GAP;
          return { tag, x, w };
        });

        return (
          <g
            key={c.id}
            className={interactive ? `connector${selected ? ' is-selected' : ''}` : undefined}
            data-connector-id={interactive ? c.id : undefined}
            data-colored={ownColor ? true : undefined}
          >
            {selected && (
              <path
                d={d}
                fill="none"
                stroke={theme.connector}
                strokeOpacity={0.22}
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {/* A halo the colour of the sheet, so a line crossing a tinted
                group or another line stays one continuous stroke to the eye —
                the way a road on a map is edged in white. */}
            <path
              d={d}
              fill="none"
              stroke={theme.sheet}
              strokeOpacity={0.55}
              strokeWidth={stroke.width + 3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="connector-stroke"
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={selected ? stroke.width + 0.4 : stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={stroke.dasharray}
              markerEnd={`url(#${marker})`}
            />
            {interactive && selected && (
              <path
                className="connector-flow"
                d={d}
                fill="none"
                stroke={theme.titleText}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                pointerEvents="none"
              />
            )}
            {interactive && (
              // Invisible fat path so the connector is easy to hit with a pointer.
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                style={{ cursor: 'pointer' }}
                onContextMenu={(e) => onContextMenu?.(e, c.id)}
                onClick={(e) => onClick?.(e, c.id)}
                onPointerDown={(e) => onPointerDown?.(e, c.id)}
                onDoubleClick={(e) => onDoubleClick?.(e, c.id)}
              />
            )}
            {anchor && (
              <g
                data-connector-label={interactive ? c.id : undefined}
                className={selected && onLabelPointerDown ? 'connector-label-control' : undefined}
                pointerEvents={interactive ? 'all' : 'none'}
                role={selected && onLabelPointerDown ? 'slider' : undefined}
                tabIndex={selected && onLabelPointerDown ? 0 : undefined}
                aria-label={selected && onLabelPointerDown ? labelPositionName : undefined}
                aria-valuemin={selected && onLabelPointerDown ? 0 : undefined}
                aria-valuemax={selected && onLabelPointerDown ? 100 : undefined}
                aria-valuenow={
                  selected && onLabelPointerDown
                    ? Math.round((c.labelAt ?? positionAlong(c.waypoints, anchor)) * 100)
                    : undefined
                }
                onPointerDown={(e) => (onLabelPointerDown ?? onPointerDown)?.(e, c.id)}
                onKeyDown={(e) => onLabelKeyDown?.(e, c.id)}
                onClick={(e) => onClick?.(e, c.id)}
                onContextMenu={(e) => onContextMenu?.(e, c.id)}
              >
                {label && (
                  <>
                    <rect
                      className="connector-label"
                      x={labelX}
                      y={anchor.y - LABEL_H / 2}
                      width={labelWidth}
                      height={LABEL_H}
                      rx={LABEL_H / 2}
                      fill={theme.connectorLabelFill}
                      fillOpacity={0.94}
                      stroke={selected ? theme.titleText : theme.connectorLabelStroke}
                      strokeOpacity={selected ? 0.6 : 1}
                      strokeWidth={1}
                      filter="url(#card-shadow)"
                    />
                    <text
                      x={labelX + labelWidth / 2}
                      y={anchor.y + 4}
                      fontSize={fontSize.xs}
                      fontWeight={fontWeight.medium}
                      fill={theme.connectorLabelText}
                      textAnchor="middle"
                    >
                      {label}
                    </text>
                  </>
                )}
                {placedTags.map(({ tag, x, w }) => {
                  const colors = toneColors(tag.tone, theme.connectorLabelFill, theme);
                  return (
                    <g key={tag.kind} data-tag={tag.kind}>
                      <rect
                        x={x}
                        y={anchor.y - TAG_H / 2}
                        width={w}
                        height={TAG_H}
                        rx={TAG_H / 2}
                        fill={colors.fill}
                        stroke={colors.stroke}
                        strokeWidth={0.75}
                      />
                      <text
                        x={x + w / 2}
                        y={anchor.y + TAG_FONT * 0.36}
                        fontSize={TAG_FONT}
                        fontWeight={fontWeight.semibold}
                        fill={colors.text}
                        textAnchor="middle"
                        letterSpacing="0.06em"
                      >
                        {tag.text.toUpperCase()}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
