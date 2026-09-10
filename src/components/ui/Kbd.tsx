import type { ReactNode } from 'react';

/**
 * A key, drawn as a key.
 *
 * Every place that names a shortcut — the palette, the menus, the context menu,
 * the tool tooltips, the shortcuts sheet, the search button — renders one of
 * these. The element stays a bare `<kbd>` because the stylesheet dresses it by
 * where it sits (`.palette-row kbd`, `.topbar-menu-item kbd`, …); `className`
 * is for the one place that also needs a layout class of its own.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={className}>{children}</kbd>;
}
