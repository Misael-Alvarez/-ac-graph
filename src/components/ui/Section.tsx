'use client';

import { useState, type ReactNode } from 'react';
import { GroupHeader } from './GroupHeader';

/**
 * A folding section of a panel: a group header that opens and shuts its body.
 *
 * The body stays mounted so the section can roll open and shut instead of
 * appearing and vanishing. `inert` is what keeps a closed section out of the
 * tab order and out of the accessibility tree — the animation is the only
 * thing that should survive being closed.
 */
export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section" data-open={open}>
      <GroupHeader
        className="inspector-section-header"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        chevron="after"
      >
        {title}
      </GroupHeader>
      <div className="inspector-shutter" inert={!open}>
        <div className="inspector-section-body">{children}</div>
      </div>
    </section>
  );
}
