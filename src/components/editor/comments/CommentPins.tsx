'use client';

import { useMemo } from 'react';
import type { CommentAnchor, CommentThread, DiagramModel } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { useComments } from './CommentsProvider';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Size of a pin on screen, in pixels, whatever the zoom. */
const PIN = 22;

interface Pin {
  key: string;
  x: number;
  y: number;
  count: number;
  /** The thread the panel lands on when the pin is pressed. */
  threadId: string;
  /** The shape it sits on, so pressing it selects the shape too. */
  shapeId: string | null;
  /** Pinned to a shape that is no longer there: drawn where the shape was, faded. */
  detached: boolean;
}

/**
 * Where each open conversation sits, as the reader sees the drawing now.
 *
 * Threads on one shape share one pin with a count, at the shape's top-right
 * corner, and follow the shape when it moves; a thread on the sheet has a pin
 * of its own where it was pinned. A thread whose shape has since been deleted
 * keeps the corner it was pinned at, faded, so what was said is not lost with
 * the shape it was said about.
 */
export function pinsFor(open: CommentThread[], model: DiagramModel): Pin[] {
  const byShape = new Map<string, CommentThread[]>();
  const pins: Pin[] = [];
  for (const thread of open) {
    if (thread.anchor.shapeId) {
      const list = byShape.get(thread.anchor.shapeId) ?? [];
      list.push(thread);
      byShape.set(thread.anchor.shapeId, list);
    } else {
      pins.push({
        key: thread.id,
        x: thread.anchor.x,
        y: thread.anchor.y,
        count: 1,
        threadId: thread.id,
        shapeId: null,
        detached: false,
      });
    }
  }
  for (const [shapeId, threads] of byShape) {
    const shape = model.shapes.find((s) => s.id === shapeId);
    const first = threads[0];
    pins.push({
      key: shapeId,
      x: shape ? shape.x + shape.w : first.anchor.x,
      y: shape ? shape.y : first.anchor.y,
      count: threads.length,
      threadId: first.id,
      shapeId: shape ? shapeId : null,
      detached: !shape,
    });
  }
  return pins;
}

/** Where a comment about to be written will land, as the pins draw it. */
export function draftPinAt(draft: CommentAnchor, model: DiagramModel): { x: number; y: number } {
  const shape = draft.shapeId ? model.shapes.find((s) => s.id === draft.shapeId) : undefined;
  return shape ? { x: shape.x + shape.w, y: shape.y } : { x: draft.x, y: draft.y };
}

/** The bubble, drawn in screen pixels: the caller undoes the zoom around it. */
function Bubble({ count }: { count?: number }) {
  return (
    <>
      {/* A small tail on the corner it points at, the body above and right of it. */}
      <path
        className="comment-pin-tail"
        d={`M0 0 L${-PIN * 0.12} ${-PIN * 0.42} L${PIN * 0.3} ${-PIN * 0.42} Z`}
      />
      <rect
        className="comment-pin-bubble"
        x={-PIN * 0.2}
        y={-PIN * 1.35}
        width={PIN}
        height={PIN}
        rx={PIN / 2}
      />
      {count !== undefined && (
        <text
          className="comment-pin-count"
          x={PIN * 0.3}
          y={-PIN * 0.85 + PIN * 0.18}
          textAnchor="middle"
          fontSize={PIN * 0.5}
          fontWeight={600}
        >
          {count}
        </text>
      )}
    </>
  );
}

export function CommentPins({
  model,
  zoom,
  draft,
  t,
  onOpen,
}: {
  /** The reading on screen: pins follow the shapes as this view places them. */
  model: DiagramModel;
  zoom: number;
  draft: CommentAnchor | null;
  t: Translate;
  onOpen: (pin: { threadId: string; shapeId: string | null }) => void;
}) {
  const { open } = useComments();
  const pins = useMemo(() => pinsFor(open, model), [open, model]);
  const ghost = draft ? draftPinAt(draft, model) : null;
  if (!pins.length && !ghost) return null;

  return (
    <g className="comment-pins">
      {pins.map((pin) => (
        <g
          key={pin.key}
          className={`comment-pin${pin.detached ? ' is-detached' : ''}`}
          transform={`translate(${pin.x} ${pin.y}) scale(${1 / zoom})`}
          role="button"
          tabIndex={-1}
          aria-label={
            pin.count === 1 ? t('comments.pinOne') : t('comments.pin', { count: pin.count })
          }
          data-thread-id={pin.threadId}
          onPointerDown={(e) => {
            // A press on a pin is for the pin: not a drag, not a lasso.
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onOpen({ threadId: pin.threadId, shapeId: pin.shapeId });
          }}
        >
          <Bubble count={pin.count} />
        </g>
      ))}
      {ghost && (
        <g
          className="comment-pin is-draft"
          transform={`translate(${ghost.x} ${ghost.y}) scale(${1 / zoom})`}
          pointerEvents="none"
        >
          <Bubble />
        </g>
      )}
    </g>
  );
}
