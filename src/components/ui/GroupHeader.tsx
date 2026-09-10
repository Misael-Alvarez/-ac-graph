'use client';

import type { ReactNode } from 'react';

type Tag = 'button' | 'div' | 'header' | 'p' | 'span' | 'h3';

/**
 * The head of a group of rows: the name, and how many rows.
 *
 * Every list with sections uses this line — the palette's "Commands", the
 * browser's "Compute", the history's day, the analysis's severity. When the
 * group can fold, it is a `button` with a chevron and `aria-expanded`;
 * otherwise it is whatever element reads best where it sits. The surface's own
 * class rides along with `group-header`, and the count's with `group-count`.
 */
export function GroupHeader({
  as = 'div',
  className,
  modifier,
  count,
  countClassName,
  open,
  onToggle,
  chevron = 'before',
  children,
}: {
  as?: Tag;
  /** The surface's own name for its headers, e.g. `browser-section-header`. */
  className?: string;
  /** An extra state class, e.g. `is-high`. */
  modifier?: string;
  count?: ReactNode;
  countClassName?: string;
  /** Present when the group folds: the header becomes a button with a chevron. */
  open?: boolean;
  onToggle?: () => void;
  /** Where the chevron sits relative to the name. */
  chevron?: 'before' | 'after';
  children: ReactNode;
}) {
  const classes = `${className ? `${className} ` : ''}group-header${modifier ? ` ${modifier}` : ''}`;
  const countNode =
    count !== undefined && count !== null ? (
      <span className={`${countClassName ? `${countClassName} ` : ''}group-count`}>{count}</span>
    ) : null;

  if (open !== undefined) {
    const chevronNode = (
      <span className={`inspector-chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
    );
    return (
      <button type="button" className={classes} aria-expanded={open} onClick={onToggle}>
        {chevron === 'before' && chevronNode}
        {children}
        {chevron === 'after' && chevronNode}
        {countNode}
      </button>
    );
  }

  const Element = as;
  return (
    <Element className={classes}>
      {children}
      {countNode}
    </Element>
  );
}
