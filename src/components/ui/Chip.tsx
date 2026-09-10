'use client';

import type { CSSProperties, ReactNode } from 'react';

/**
 * A chip: a small toggle with a name and, often, a count.
 *
 * The cloud tabs of the service browser and the icon picker and the folder
 * filters of the library are all chips. `className` is the surface's own name
 * (`browser-cloud`, `library-folder`), `chip` is the shared anatomy; the dot
 * and the count carry the same pair when the surface names them.
 */
export function Chip({
  className,
  active = false,
  modifier,
  role,
  title,
  color,
  dotClassName,
  count,
  countClassName,
  onClick,
  children,
}: {
  className: string;
  active?: boolean;
  /** An extra state class, e.g. `is-mine`. */
  modifier?: string;
  /** `tab` chips announce their selection; plain chips do not. */
  role?: 'tab';
  title?: string;
  /** Sets `--cloud-color`, the hue the dot and the active ring take. */
  color?: string;
  /** Renders a dot before the label, with this surface class beside `chip-dot`. */
  dotClassName?: string;
  count?: ReactNode;
  countClassName?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-selected={role === 'tab' ? active : undefined}
      className={`${className} chip${modifier ? ` ${modifier}` : ''}${active ? ' is-active' : ''}`}
      title={title}
      style={color ? ({ '--cloud-color': color } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {dotClassName !== undefined && (
        <span className={`${dotClassName ? `${dotClassName} ` : ''}chip-dot`} />
      )}
      {children}
      {count !== undefined && count !== null && (
        <span className={`${countClassName ? `${countClassName} ` : ''}chip-count`}>{count}</span>
      )}
    </button>
  );
}

/** The row chips sit in; a `tablist` when they are tabs. */
export function ChipRow({
  className,
  label,
  tabs = false,
  children,
}: {
  className: string;
  /** The accessible name of the tab list. */
  label?: string;
  tabs?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`${className} chip-row`}
      role={tabs ? 'tablist' : undefined}
      aria-label={tabs ? label : undefined}
    >
      {children}
    </div>
  );
}
