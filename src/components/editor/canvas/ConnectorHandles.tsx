'use client';

import { useId, useRef } from 'react';
import type { Connector, Point } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';

/** Editing chrome only: never mounted in a share, export or read-only canvas. */
export function ConnectorHandles({
  connector,
  zoom,
  onPointerDown,
  onChange,
  t,
}: {
  connector: Connector;
  zoom: number;
  onPointerDown: (e: React.PointerEvent, index: number) => void;
  onChange: (waypoints: Point[], coalesceKey?: string) => void;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}) {
  const gestureId = useId();
  const burst = useRef({ at: 0, key: '', count: 0 });
  return (
    <g className="connector-handles">
      {connector.waypoints.slice(1, -1).map((point, i) => {
        const index = i + 1;
        return (
          <g
            key={index}
            data-bend-index={index}
            className="connector-handle"
            transform={`translate(${point.x} ${point.y}) scale(${1 / zoom})`}
            role="button"
            tabIndex={0}
            aria-label={t('canvas.bend', { index })}
            onPointerDown={(e) => onPointerDown(e, index)}
            onClick={(e) => e.stopPropagation()}
            onFocus={() => {
              burst.current.at = 0;
            }}
            onKeyDown={(e) => {
              if (e.altKey || e.ctrlKey || e.metaKey) return;
              const remove = e.key === 'Delete' || e.key === 'Backspace';
              const delta: Record<string, [number, number]> = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              };
              if (!remove && !delta[e.key]) return;
              e.preventDefault();
              e.stopPropagation();
              if (remove) {
                onChange(connector.waypoints.filter((_, j) => j !== index));
                requestAnimationFrame(() => {
                  const next = document.querySelector<SVGElement>(
                    `[data-bend-index="${Math.max(1, index - 1)}"]`,
                  );
                  (next ?? document.querySelector<SVGElement>('.canvas-surface'))?.focus({
                    preventScroll: true,
                  });
                });
                return;
              }
              const now = Date.now();
              const key = `${connector.id}:${index}`;
              if (key !== burst.current.key || now - burst.current.at > 800) burst.current.count++;
              burst.current.key = key;
              burst.current.at = now;
              const [dx, dy] = delta[e.key];
              const step = e.shiftKey ? 10 : 1;
              onChange(
                connector.waypoints.map((p, j) =>
                  j === index ? { x: p.x + dx * step, y: p.y + dy * step } : p,
                ),
                `bend:${gestureId}:${key}:${burst.current.count}`,
              );
            }}
          >
            <title>{t('canvas.bendHelp')}</title>
            <circle className="connector-handle-hit" r={14} fill="transparent" />
            <circle className="connector-handle-dot" r={4.5} />
          </g>
        );
      })}
    </g>
  );
}
