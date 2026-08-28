'use client';

import { useState } from 'react';
import { CATEGORY_SHORT_LABELS, SERVICE_ICONS } from '@/data/serviceIcons';
import { CLOUD_TARGETS, getEquivalents } from '@/data/cloudEquivalents';
import type { EdgeMeta, NodeMeta, Shape } from '@/lib/domain';
import type { MessageKey } from '@/lib/i18n/messages';
import { isColor, providerColors } from '@/lib/design/tokens';
import { CLOUD_KEY_PREFIX } from '@/lib/editor/providers';
import { useEditor } from '../EditorProvider';
import { TrashIcon } from '@/components/icons/ToolIcons';
import { IconPicker } from './IconPicker';

/**
 * Every cloud a service can be rewritten into.
 *
 * Derived from the equivalence table rather than listed here: the table grew to
 * five clouds when the catalogue did, and this panel went on offering three, so
 * an Oracle or IBM diagram could be built but never switched.
 */
const CLOUDS = CLOUD_TARGETS.map((target) => ({
  target,
  label: CATEGORY_SHORT_LABELS[target] ?? target.toUpperCase(),
  color: providerColors[target],
  prefix: CLOUD_KEY_PREFIX[target],
}));

/**
 * The vocabularies, in the order a reader thinks about them.
 *
 * Mirrors the enums in `src/lib/domain/diagram.ts`; the DSL accepts exactly
 * these words, which is why they are shown unchanged.
 */
const ENVIRONMENTS = ['dev', 'qa', 'staging', 'prod'] as const;
const CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;
const LIFECYCLES = ['planned', 'active', 'deprecated', 'retired'] as const;
const PROTOCOLS = [
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
const EDGE_KINDS = ['sync', 'async', 'event', 'data', 'dependency'] as const;
const DATA_CLASSES = ['public', 'internal', 'confidential', 'pii', 'pci', 'phi'] as const;

/** What the swatch shows when a shape has no fill of its own. */
const DEFAULT_FILL = '#f1f3f4';

function Section({
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inspector-field">
      <span className="inspector-field-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * A field whose answers are a fixed list.
 *
 * The options are shown with the exact word the DSL uses — `prod`, `grpc`,
 * `pii` — rather than a translated label. The code panel and this panel are two
 * views of one document, and a reader who sets "producción" here and then reads
 * `prod` in the YAML has been told they are different things.
 */
function ChoiceField({
  label,
  value,
  options,
  unset,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  unset: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <Field label={label}>
      <select
        className="input is-choice"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{unset}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </Field>
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
function FillField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
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
        <input
          type="color"
          value={isColor(value) ? value : DEFAULT_FILL}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          className={`input${invalid ? ' is-invalid' : ''}`}
          value={draft}
          placeholder={DEFAULT_FILL}
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
 * The message key naming what a shape is.
 *
 * `shape.type` is a domain identifier — 'group', 'item' — and reached the panel
 * header verbatim, so a Spanish interface announced "Group". A boundary is two
 * different things to the reader depending on its variant, which is why this
 * takes the shape rather than the type.
 */
function shapeTypeKey(shape: Shape): MessageKey {
  if (shape.type === 'boundary') {
    return shape.variant === 'sub' ? 'inspector.type.subboundary' : 'inspector.type.boundary';
  }
  return `inspector.type.${shape.type}` as MessageKey;
}

export function InspectorPanel() {
  const { ui, doc, selectedShape, dispatch, dispatchUi, t } = useEditor();

  if (ui.selectedIds.size === 0 && !ui.selectedConnectorId) return null;

  if (ui.selectedConnectorId) {
    const connector = doc.model.connectors.find((c) => c.id === ui.selectedConnectorId);
    if (!connector) return null;

    const patchEdgeMeta = (values: Partial<EdgeMeta>) =>
      dispatch({
        type: 'setConnectorProps',
        id: connector.id,
        patch: { meta: { ...connector.meta, ...values } },
      });
    return (
      <aside className="inspector" aria-label={t('inspector.title')}>
        <header className="inspector-header">{t('inspector.title')}</header>
        <Section title={t('inspector.content')}>
          <Field label={t('inspector.label')}>
            <input
              className="input"
              value={connector.label}
              onChange={(e) =>
                dispatch({
                  type: 'setConnectorProps',
                  id: connector.id,
                  patch: { label: e.target.value },
                })
              }
            />
          </Field>
          <div className="segmented">
            {(['solid', 'dashed'] as const).map((style) => (
              <button
                key={style}
                type="button"
                className={`segmented-option${connector.style === style ? ' is-active' : ''}`}
                onClick={() =>
                  dispatch({ type: 'setConnectorProps', id: connector.id, patch: { style } })
                }
              >
                {t(style === 'solid' ? 'inspector.solid' : 'inspector.dashed')}
              </button>
            ))}
          </div>
        </Section>

        {/* What the arrow means, as opposed to how it is drawn. `A -> B` says
            almost nothing; whether the call is synchronous, what carries it and
            whether customer data travels along it is what can be checked. */}
        <Section title={t('inspector.link')} defaultOpen={false}>
          <ChoiceField
            label={t('inspector.protocol')}
            value={connector.meta?.protocol}
            options={PROTOCOLS}
            unset={t('inspector.unset')}
            onChange={(v) => patchEdgeMeta({ protocol: v as EdgeMeta['protocol'] })}
          />
          <ChoiceField
            label={t('inspector.kind')}
            value={connector.meta?.kind}
            options={EDGE_KINDS}
            unset={t('inspector.unset')}
            onChange={(v) => patchEdgeMeta({ kind: v as EdgeMeta['kind'] })}
          />
          <Field label={t('inspector.auth')}>
            <input
              className="input"
              value={connector.meta?.auth ?? ''}
              placeholder="OAuth2"
              onChange={(e) => patchEdgeMeta({ auth: e.target.value || undefined })}
            />
          </Field>
          <ChoiceField
            label={t('inspector.dataClass')}
            value={connector.meta?.dataClass}
            options={DATA_CLASSES}
            unset={t('inspector.unset')}
            onChange={(v) => patchEdgeMeta({ dataClass: v as EdgeMeta['dataClass'] })}
          />
        </Section>
        <div className="inspector-actions">
          <button
            type="button"
            className="button is-danger"
            onClick={() => {
              dispatch({ type: 'deleteConnector', id: connector.id });
              dispatchUi({ type: 'clearSelection' });
            }}
          >
            <TrashIcon size={14} /> {t('action.delete')}
          </button>
        </div>
      </aside>
    );
  }

  if (!selectedShape) {
    return (
      <aside className="inspector" aria-label={t('inspector.title')}>
        <header className="inspector-header">{t('inspector.title')}</header>
        <p className="inspector-note">{t('inspector.multi', { count: ui.selectedIds.size })}</p>
        <div className="inspector-actions">
          <button
            type="button"
            className="button is-danger"
            onClick={() => {
              dispatch({ type: 'deleteShapes', ids: [...ui.selectedIds] });
              dispatchUi({ type: 'clearSelection' });
            }}
          >
            <TrashIcon size={14} /> {t('action.delete')}
          </button>
        </div>
      </aside>
    );
  }

  const shape = selectedShape;
  const iconKey = shape.icon?.key;
  const cloudSwitchable =
    shape.type === 'item' && iconKey && !iconKey.startsWith('gen-') && !iconKey.startsWith('aion-');
  const equivalents = iconKey ? getEquivalents(iconKey) : null;

  /**
   * The clouds this service can be in: the one it is in now, and the ones the
   * equivalence table actually names a service for.
   */
  const options = CLOUDS.flatMap(({ target, label, prefix }) => {
    const current = !!iconKey?.startsWith(prefix);
    const key = current ? iconKey! : equivalents?.[target];
    if (!key) return [];
    const service = SERVICE_ICONS.find((s) => s.key === key);
    return [{ target, label, current, service: service?.label ?? key }];
  });
  const patch = (values: Partial<typeof shape>) =>
    dispatch({ type: 'setShapeProps', id: shape.id, patch: values });

  // Merged, not replaced: the reducer assigns the patch wholesale, so writing
  // one field would otherwise erase the rest of what the node knows about
  // itself.
  const patchMeta = (values: Partial<NodeMeta>) => patch({ meta: { ...shape.meta, ...values } });

  return (
    <aside className="inspector" aria-label={t('inspector.title')}>
      <header className="inspector-header">
        {t('inspector.title')}
        <span className="inspector-type">{t(shapeTypeKey(shape))}</span>
      </header>

      <Section title={t('inspector.content')}>
        <Field label={t('inspector.label')}>
          <input
            className="input"
            value={shape.title ?? ''}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
        {shape.type === 'item' && (
          <>
            <Field label={t('inspector.subtitle')}>
              <input
                className="input"
                value={shape.subtitle ?? ''}
                onChange={(e) => patch({ subtitle: e.target.value })}
              />
            </Field>
            <Field label={t('inspector.note')}>
              <input
                className="input"
                value={shape.note ?? ''}
                onChange={(e) => patch({ note: e.target.value })}
              />
            </Field>
          </>
        )}
      </Section>

      <Section title={t('inspector.appearance')}>
        {(shape.type === 'item' || shape.type === 'boundary') && (
          /* Not a `<label>`: the picker's control is a button that opens a
             dialog, and wrapping it would make every click inside the dialog
             re-trigger the label. */
          <div className="inspector-field">
            <span className="inspector-field-label">{t('inspector.icon')}</span>
            <IconPicker
              value={iconKey}
              t={t}
              locale={ui.locale}
              onChange={(key) => patch({ icon: { kind: 'symbol', key } })}
            />
          </div>
        )}
        <FillField
          label={t('inspector.fill')}
          value={shape.fill}
          onChange={(fill) => patch({ fill })}
        />
      </Section>

      {shape.type === 'item' && (
        <Section title={t('inspector.meta')} defaultOpen={false}>
          <Field label={t('inspector.technology')}>
            <input
              className="input"
              value={shape.meta?.technology ?? ''}
              placeholder="FastAPI"
              onChange={(e) => patchMeta({ technology: e.target.value || undefined })}
            />
          </Field>
          <Field label={t('inspector.owner')}>
            <input
              className="input"
              value={shape.meta?.owner ?? ''}
              placeholder="payments-platform"
              onChange={(e) => patchMeta({ owner: e.target.value || undefined })}
            />
          </Field>
          <Field label={t('inspector.repository')}>
            <input
              className="input"
              value={shape.meta?.repository ?? ''}
              placeholder="github/payments-api"
              onChange={(e) => patchMeta({ repository: e.target.value || undefined })}
            />
          </Field>
          <ChoiceField
            label={t('inspector.environment')}
            value={shape.meta?.environment}
            options={ENVIRONMENTS}
            unset={t('inspector.unset')}
            onChange={(v) => patchMeta({ environment: v as NodeMeta['environment'] })}
          />
          <ChoiceField
            label={t('inspector.criticality')}
            value={shape.meta?.criticality}
            options={CRITICALITIES}
            unset={t('inspector.unset')}
            onChange={(v) => patchMeta({ criticality: v as NodeMeta['criticality'] })}
          />
          <ChoiceField
            label={t('inspector.lifecycle')}
            value={shape.meta?.lifecycle}
            options={LIFECYCLES}
            unset={t('inspector.unset')}
            onChange={(v) => patchMeta({ lifecycle: v as NodeMeta['lifecycle'] })}
          />
          <Field label={t('inspector.tags')}>
            <input
              className="input"
              value={shape.meta?.tags?.join(', ') ?? ''}
              placeholder={t('inspector.tagsHint')}
              onChange={(e) => {
                const tags = e.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean);
                patchMeta({ tags: tags.length ? tags : undefined });
              }}
            />
          </Field>
        </Section>
      )}

      {cloudSwitchable && (
        <Section title={t('inspector.cloud')}>
          {equivalents && <p className="inspector-note">{equivalents.role}</p>}

          {/* One row per cloud this service actually exists in, and none for the
              clouds it does not. Two thirds of the equivalence table has gaps,
              so the old row of five chips was mostly buttons that did nothing
              when pressed — and it said nothing about what pressing them would
              get you, which the row beside the name now does. */}
          {options.length > 1 ? (
            <div className="cloud-switch">
              {options.map((option) => (
                <button
                  key={option.target}
                  type="button"
                  className={`cloud-chip cloud-option${option.current ? ' is-active' : ''}`}
                  style={{ '--cloud-color': providerColors[option.target] } as React.CSSProperties}
                  disabled={option.current}
                  onClick={() =>
                    dispatch({
                      type: 'switchShapeCloud',
                      id: shape.id,
                      target: option.target,
                      locale: ui.locale,
                    })
                  }
                >
                  <span className="chip-dot" aria-hidden="true" />
                  <span className="cloud-option-name">{option.label}</span>
                  <span className="cloud-option-service">{option.service}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="inspector-note">{t('inspector.noEquivalents')}</p>
          )}
        </Section>
      )}

      <Section title={t('inspector.position')} defaultOpen={false}>
        <div className="position-grid">
          <span>X</span>
          <b>{Math.round(shape.x)}</b>
          <span>Y</span>
          <b>{Math.round(shape.y)}</b>
          <span>W</span>
          <b>{Math.round(shape.w)}</b>
          <span>H</span>
          <b>{Math.round(shape.h)}</b>
        </div>
        {shape.type === 'item' && (
          <div className="button-row">
            <button
              type="button"
              className="button"
              onClick={() => dispatch({ type: 'reorderItem', id: shape.id, dir: -1 })}
            >
              {t('inspector.moveUp')}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => dispatch({ type: 'reorderItem', id: shape.id, dir: 1 })}
            >
              {t('inspector.moveDown')}
            </button>
          </div>
        )}
      </Section>

      <div className="inspector-actions">
        <button
          type="button"
          className="button is-danger"
          onClick={() => {
            dispatch({ type: 'deleteShapes', ids: [...ui.selectedIds] });
            dispatchUi({ type: 'clearSelection' });
          }}
        >
          <TrashIcon size={14} /> {t('action.delete')}
        </button>
      </div>
    </aside>
  );
}
