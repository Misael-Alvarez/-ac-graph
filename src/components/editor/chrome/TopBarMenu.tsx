'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { exitProps } from '@/lib/editor/usePresence';

/**
 * A menu hanging from a top bar control.
 *
 * Closes on Escape, on a click anywhere else, and when focus leaves it. Arrow
 * keys walk the items, so the menu is usable without a pointer; the first
 * item takes focus on open so a keyboard user lands inside it.
 */
export function TopBarMenu({
  label,
  onClose,
  align = 'right',
  closing = false,
  onExited = () => {},
  children,
}: {
  label: string;
  onClose: () => void;
  align?: 'left' | 'right';
  /** Playing its exit: inert, and gone when the animation ends. */
  closing?: boolean;
  onExited?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const items = () =>
      Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'));
    items()[0]?.focus();

    const onPointer = (event: PointerEvent) => {
      const host = menu.parentElement;
      if (host && event.target instanceof Node && host.contains(event.target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const list = items();
      if (!list.length) return;
      event.preventDefault();
      const index = list.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'ArrowDown'
          ? list[(index + 1) % list.length]
          : list[(index - 1 + list.length) % list.length];
      next.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={`topbar-menu${align === 'left' ? ' is-left' : ''}`}
      inert={closing || undefined}
      {...exitProps(closing, onExited)}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  shortcut,
  disabled,
  active,
  danger,
  onSelect,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  /** A destructive item: drawn in the danger colour so it is not hit by habit. */
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`topbar-menu-item${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon ? (
        <span className="menu-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="menu-text">
        <span>{label}</span>
        {hint ? <small>{hint}</small> : null}
      </span>
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

export function MenuGroup({ label }: { label: string }) {
  return <p className="topbar-menu-group">{label}</p>;
}

export function MenuSeparator() {
  return <span className="topbar-menu-separator" role="separator" />;
}
