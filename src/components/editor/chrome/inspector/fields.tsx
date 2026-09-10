'use client';

import { useState } from 'react';
import { CATEGORY_SHORT_LABELS } from '@/data/serviceIcons';
import { isColor, mixHex } from '@/lib/design/tokens';
import { PROVIDER_COLORS } from '@/lib/editor/providers';
import type { Tone } from '@/lib/editor/meta';

/**
 * The vocabularies, in the order a reader thinks about them.
 *
 * Mirrors the enums in `src/lib/domain/diagram.ts`; the DSL accepts exactly
 * these words, which is why they are shown unchanged.
 */
export const ENVIRONMENTS = ['dev', 'qa', 'staging', 'prod'] as const;
export const CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;
export const LIFECYCLES = ['planned', 'active', 'deprecated', 'retired'] as const;
export const PROTOCOLS = [
  'http',
  'https',
  'grpc',
  'websocket',
  'kafka',
  'amqp',
  'sql',
  'redis',
  'file',
  'other',
] as const;
export const EDGE_KINDS = ['sync', 'async', 'event', 'data', 'dependency'] as const;
export const DATA_CLASSES = ['public', 'internal', 'confidential', 'pii', 'pci', 'phi'] as const;

export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="inspector-section" data-open={open}>
      <button
        type="button"
        className="inspector-section-header group-header"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <span className={`inspector-chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      {/* The body stays mounted so the section can roll open and shut instead
          of appearing and vanishing. `inert` is what keeps a closed section out
          of the tab order and out of the accessibility tree — the animation is
          the only thing that should survive being closed. */}
      <div className="inspector-shutter" inert={!open}>
        <div className="inspector-section-body">{children}</div>
      </div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inspector-field">
      <span className="inspector-field-label">{label}</span>
      {children}
    </label>
  );
}

/** The hue behind a chip, matching the marks the canvas draws for the same word. */
const TONE_HEX: Record<Tone, string> = {
  neutral: '#64748b',
  info: '#0284c7',
  success: '#15803d',
  warning: '#d97706',
  danger: '#dc2626',
  accent: '#6d28d9',
};

const TONES: Record<string, Tone> = {
  dev: 'neutral',
  qa: 'info',
  staging: 'warning',
  prod: 'success',
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
  planned: 'accent',
  active: 'success',
  deprecated: 'warning',
  retired: 'neutral',
  public: 'neutral',
  internal: 'neutral',
  confidential: 'warning',
  pii: 'danger',
  pci: 'danger',
  phi: 'danger',
};

/**
 * A field whose answers are a fixed list, offered as chips.
 *
 * Every answer is visible and one press away, which a `<select>` never
 * managed: it hid the list behind a click and gave no sense of which words
 * were even possible. The chips carry the same hue the canvas will draw the
 * word in, so choosing `prod` here shows exactly what the card will show.
 *
 * The options are the exact words the DSL uses — `prod`, `grpc`, `pii` —
 * rather than translated labels. The code panel and this panel are two views
 * of one document, and a reader who sets "producción" here and then reads
 * `prod` in the YAML has been told they are different things.
 */
export function ChoiceField({
  label,
  value,
  options,
  unset,
  dark,
  display,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  unset: string;
  dark: boolean;
  /** How an option is spelled on its chip, when not the raw word. */
  display?: (option: string) => string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="inspector-field" role="radiogroup" aria-label={label}>
      <span className="inspector-field-label">{label}</span>
      <div className="chip-choices">
        <button
          type="button"
          role="radio"
          aria-checked={value === undefined}
          className={`chip-choice is-unset${value === undefined ? ' is-active' : ''}`}
          onClick={() => onChange(undefined)}
        >
          {unset}
        </button>
        {options.map((option) => {
          const tone = TONES[option];
          const hex = tone ? TONE_HEX[tone] : undefined;
          const color = hex ? (dark ? mixHex(hex, '#ffffff', 0.4) : hex) : undefined;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={value === option}
              className={`chip-choice${value === option ? ' is-active' : ''}`}
              style={color ? ({ '--chip-color': color } as React.CSSProperties) : undefined}
              onClick={() => onChange(option)}
            >
              {display ? display(option) || option : option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The fills a shape can take in one press: the theme's own, then each cloud. */
const FILL_PRESETS = ['aws', 'azure', 'gcp', 'oci', 'ibm', 'aion'] as const;

/**
 * A row of preset swatches above the free colour field.
 *
 * Most fills anyone wants are "the colour of that cloud"; typing a hex for it
 * was the only way to get one, and nobody knows the hex of AWS orange.
 */
export function FillPresets({
  value,
  kind,
  onChange,
}: {
  value?: string;
  kind: 'fill' | 'border';
  onChange: (fill: string | undefined) => void;
}) {
  return (
    <div className="fill-presets" role="group">
      <button
        type="button"
        className={`fill-swatch is-none${value === undefined ? ' is-active' : ''}`}
        title="—"
        aria-label="—"
        aria-pressed={value === undefined}
        onClick={() => onChange(undefined)}
      />
      {FILL_PRESETS.map((provider) => {
        const palette = PROVIDER_COLORS[provider];
        if (!palette) return null;
        const color = kind === 'fill' ? palette.fill : palette.border;
        return (
          <button
            key={provider}
            type="button"
            className={`fill-swatch${value === color ? ' is-active' : ''}`}
            style={
              { '--chip-color': color, '--cloud-color': palette.border } as React.CSSProperties
            }
            title={CATEGORY_SHORT_LABELS[provider] ?? provider}
            aria-label={CATEGORY_SHORT_LABELS[provider] ?? provider}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
          />
        );
      })}
    </div>
  );
}

/**
 * The fill colour, as a swatch and as text.
 *
 * The text half used to write straight through to the shape, so a half-typed
 * `#12` — or `rojo` — became the shape's fill, and an unpaintable fill in an
 * exported SVG is painted black. The typing is local now, and only a colour
 * that can actually be painted is committed. Emptying the field clears the
 * fill back to the theme's own rather than storing an empty string.
 */
export function FillField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value?: string;
  /** What the shape is actually painted with when it has no fill of its own. */
  fallback: string;
  onChange: (fill: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [synced, setSynced] = useState(value);

  if (synced !== value) {
    // The value changed underneath the field: another shape selected, an undo,
    // or the swatch beside it. Adjusted during render rather than in an effect
    // so nothing is ever painted with a stale draft.
    setSynced(value);
    setDraft(value ?? '');
  }

  const invalid = draft !== '' && !isColor(draft);

  return (
    <Field label={label}>
      <div className="color-field">
        {/* The swatch shows the colour on the canvas — in the dark theme a
            shape without a fill is a dark card, and a white swatch beside it
            was describing a different diagram. */}
        <input
          type="color"
          value={isColor(value) ? value : fallback}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          className={`input${invalid ? ' is-invalid' : ''}`}
          value={draft}
          placeholder={fallback}
          spellCheck={false}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const next = e.target.value.trim();
            setDraft(e.target.value);
            if (next === '') onChange(undefined);
            else if (isColor(next)) onChange(next);
          }}
        />
      </div>
    </Field>
  );
}

/**
 * Contextual properties panel.
 *
 * It only exists while something is selected: the previous editor kept a 280px
 * column permanently on screen showing "no selection" most of the time.
 */
/**
 * A number the reader can type or nudge, committed as it changes.
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

/**
 * The message key naming what a shape is.
 *
 * `shape.type` is a domain identifier — 'group', 'item' — and reached the panel
 * header verbatim, so a Spanish interface announced "Group". A boundary is two
 * different things to the reader depending on its variant, which is why this
 * takes the shape rather than the type.
 */
