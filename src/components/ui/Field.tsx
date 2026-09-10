'use client';

import { useState, type ReactNode } from 'react';

/**
 * A labelled control: the name above, the control below, one `<label>` so a
 * click on the name focuses the control. The inspector's fields and the icon
 * upload form are all this.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="inspector-field">
      <span className="inspector-field-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * A number the reader can type or nudge.
 *
 * The position section used to print X, Y, W and H as text: four facts and
 * nothing to do with them. Each is a field now; typing a value or pressing the
 * arrows moves or resizes the shape at once, and a run of arrow presses is one
 * undo step. Anything that does not parse is left in the field, uncommitted.
 */
export function NumberField({
  label,
  value,
  min,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(String(value));
  }
  return (
    <label className={`number-field${disabled ? ' is-disabled' : ''}`}>
      <span className="number-field-label">{label}</span>
      <input
        className="number-field-input"
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(next) && next !== value) {
            onCommit(min !== undefined ? Math.max(min, next) : next);
          }
        }}
        onBlur={() => setDraft(String(value))}
      />
    </label>
  );
}
