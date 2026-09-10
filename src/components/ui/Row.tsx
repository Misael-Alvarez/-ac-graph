'use client';

import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

/**
 * One row of a list: a leading mark, the text, and something on the right.
 *
 * The palette's commands and services and the analysis's findings are rows.
 * The parts come in a fixed order — icon, text, meta — and the row is a button
 * because every row does something when chosen. Surface classes ride on
 * `className`; anything the surface's list needs on the element (`id`,
 * `data-index`, `role`, `aria-selected`, pointer handlers) comes through `rest`.
 */
export function Row({
  className,
  active = false,
  index,
  icon,
  children,
  meta,
  onClick,
  ...rest
}: {
  className: string;
  active?: boolean;
  /** Sets `--i`, the stagger index the stylesheet animates by. */
  index?: number;
  icon?: ReactNode;
  children: ReactNode;
  meta?: ReactNode;
  onClick: () => void;
} & Omit<HTMLAttributes<HTMLButtonElement>, 'className' | 'onClick' | 'children' | 'style'>) {
  return (
    <button
      type="button"
      className={`${className}${active ? ' is-active' : ''}`}
      style={index === undefined ? undefined : ({ '--i': index } as CSSProperties)}
      onClick={onClick}
      {...rest}
    >
      {icon}
      {children}
      {meta}
    </button>
  );
}
