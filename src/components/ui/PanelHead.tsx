'use client';

import type { ReactNode } from 'react';
import { CloseIcon } from '@/components/icons/ToolIcons';

/**
 * The head of a panel: what it is, how much is in it, the way out.
 *
 * Every panel in the product — the service browser, the history, the
 * analysis, the code view, the command palette — opens with this same row, so
 * the row is one component rather than five copies of the same markup. The
 * classes it renders are the ones the stylesheet already dresses; a panel
 * that used them by hand renders identically through here.
 *
 * `title` may be any node so a panel can put a control (the code view's
 * YAML/Mermaid switch) where its name would be. `count` is the number the
 * panel is about, spelled by the caller. `actions` sit between the count and
 * the close button.
 */
export function PanelHead({
  title,
  count,
  actions,
  closeLabel,
  onClose,
  className,
  countClassName,
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Extra classes on the header, for a panel with a head of its own kind. */
  className?: string;
  /** Extra classes on the count, where a panel's tests or styles name it. */
  countClassName?: string;
}) {
  return (
    <header className={`code-panel-header panel-head${className ? ` ${className}` : ''}`}>
      {typeof title === 'string' ? (
        <strong className="side-panel-title panel-head-title">{title}</strong>
      ) : (
        title
      )}
      <span className="code-panel-spacer" />
      {count !== undefined && count !== null && (
        <span className={`result-count${countClassName ? ` ${countClassName}` : ''}`}>{count}</span>
      )}
      {actions}
      <button type="button" className="icon-button" aria-label={closeLabel} onClick={onClose}>
        <CloseIcon size={16} />
      </button>
    </header>
  );
}
