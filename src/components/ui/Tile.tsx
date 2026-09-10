'use client';

import type { DragEvent, ReactNode } from 'react';

/**
 * A service in a list or a grid: its icon, its name, and a word of context.
 *
 * The browser's tiles and the icon picker's tiles are the same thing at two
 * sizes, so they are one component. The order of the parts is fixed — icon,
 * marker, name, meta — and a tile that can be dragged onto the canvas carries
 * its key as `text/plain`, which is what the canvas reads on drop. The
 * surface's own classes (`browser-tile`, `icon-picker-tile-label`) ride on
 * `className` and `labelClassName`, because the stylesheet and the tests name
 * them.
 */
export function Tile({
  className,
  modifier,
  current,
  dataKey,
  dragKey,
  title,
  onClick,
  icon,
  marker,
  label,
  labelClassName,
  meta,
}: {
  className: string;
  /** An extra state class, e.g. `is-upload`. */
  modifier?: string;
  /** When given, the tile is a pressable choice: `aria-pressed` and `is-current`. */
  current?: boolean;
  /** `data-key`, for whoever needs to find this tile in the DOM. */
  dataKey?: string;
  /** Makes the tile draggable, carrying this key onto the canvas. */
  dragKey?: string;
  title?: string;
  onClick: () => void;
  icon: ReactNode;
  /** A small mark between icon and name (the picker's cloud dot). */
  marker?: ReactNode;
  label: ReactNode;
  labelClassName: string;
  /** What follows the name (the browser's cloud, an upload hint). */
  meta?: ReactNode;
}) {
  const onDragStart =
    dragKey === undefined
      ? undefined
      : (event: DragEvent<HTMLButtonElement>) => {
          event.dataTransfer.setData('text/plain', dragKey);
          event.dataTransfer.effectAllowed = 'copy';
        };
  return (
    <button
      type="button"
      data-key={dataKey}
      className={`${className}${current ? ' is-current' : ''}${modifier ? ` ${modifier}` : ''}`}
      aria-pressed={current === undefined ? undefined : current}
      title={title}
      draggable={dragKey === undefined ? undefined : true}
      onDragStart={onDragStart}
      onClick={onClick}
    >
      {icon}
      {marker}
      <span className={labelClassName}>{label}</span>
      {meta}
    </button>
  );
}

/** A catalogue icon drawn from the sprite in `<Defs>`, sized by the surface's class. */
export function SpriteIcon({ serviceKey, className }: { serviceKey: string; className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <use href={`#i-${serviceKey}`} width={24} height={24} />
    </svg>
  );
}
