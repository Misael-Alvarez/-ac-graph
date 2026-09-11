'use client';

import { CATEGORY_SHORT_LABELS, SERVICE_ICONS } from '@/data/serviceIcons';
import { CLOUD_TARGETS, getEquivalents } from '@/data/cloudEquivalents';
import type { NodeMeta, Shape } from '@/lib/domain';
import { canvasTheme, providerColors } from '@/lib/design/tokens';
import { CLOUD_KEY_PREFIX } from '@/lib/editor/providers';
import { TrashIcon } from '@/components/icons/ToolIcons';
import { useEditor } from '../../EditorProvider';
import { IconPicker } from '../IconPicker';
import { Field, NumberField } from '@/components/ui/Field';
import { Section } from '@/components/ui/Section';
import {
  ChoiceField,
  CRITICALITIES,
  ENVIRONMENTS,
  FillField,
  FillPresets,
  LIFECYCLES,
  NOTE_PAPERS,
} from './fields';
import { ShapeHero, shapeTypeKey } from './ShapeHero';

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
 * The inspector for one shape: its name and text, its icon and fill, what it
 * is (the facts the card wears as chips), which cloud it could be in, and where
 * it sits. `selectedIds` is what Delete removes — the whole selection, which
 * here is exactly this shape.
 */
export function ShapeInspector({
  shape,
  selectedIds,
  stepKey,
  nextBurst,
}: {
  shape: Shape;
  selectedIds: string[];
  stepKey: (id: string, fields: string[]) => string;
  nextBurst: () => void;
}) {
  const { doc, ui, view, dispatch, dispatchUi, t } = useEditor();
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
    dispatch({
      type: 'setShapeProps',
      id: shape.id,
      patch: values,
      coalesceKey: stepKey(shape.id, Object.keys(values)),
    });

  // Merged, not replaced: the reducer assigns the patch wholesale, so writing
  // one field would otherwise erase the rest of what the node knows about
  // itself.
  const patchMeta = (values: Partial<NodeMeta>) => patch({ meta: { ...shape.meta, ...values } });

  const theme = canvasTheme(ui.dark);
  // What the colour *is* for each kind of thing, said in its own word: a card
  // is filled, a region tinted, a note is paper and a text is ink.
  const colour = {
    label:
      shape.type === 'note'
        ? t('inspector.paper')
        : shape.type === 'region'
          ? t('inspector.tint')
          : shape.type === 'text'
            ? t('inspector.ink')
            : t('inspector.fill'),
    fallback:
      shape.type === 'note'
        ? theme.notePaper
        : shape.type === 'region'
          ? theme.regionTint
          : shape.type === 'text'
            ? theme.titleText
            : shape.type === 'item'
              ? theme.itemFill
              : theme.groupFill,
  };

  return (
    <aside className="inspector" aria-label={t('inspector.title')} onFocus={nextBurst}>
      <ShapeHero
        shape={shape}
        iconKey={iconKey}
        typeLabel={t(shapeTypeKey(shape))}
        titleLabel={t('inspector.label')}
        customIcons={doc.model.customIcons ?? []}
        customBadge={t('icons.customBadge')}
        onRename={(title) => patch({ title })}
      />

      {(shape.type === 'note' || shape.type === 'text') && (
        <Section title={t('inspector.content')}>
          <Field label={t('inspector.text')}>
            <textarea
              className="input is-multiline"
              value={shape.title ?? ''}
              rows={shape.type === 'note' ? 6 : 3}
              spellCheck={false}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
          <p className="inspector-note">{t('inspector.textHint')}</p>
        </Section>
      )}

      {shape.type === 'item' && (
        <Section title={t('inspector.content')}>
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
        </Section>
      )}

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
              customIcons={doc.model.customIcons ?? []}
              onChange={(key) => patch({ icon: { kind: 'symbol', key } })}
              onPickCustom={(icon) => {
                // Embed first, then point at it: the card must find its symbol
                // in the very render that gives it the key.
                dispatch({ type: 'addCustomIcon', icon });
                patch({ icon: { kind: 'symbol', key: icon.key } });
              }}
            />
          </div>
        )}
        <FillPresets
          value={shape.fill}
          kind={shape.type === 'container' || shape.type === 'text' ? 'border' : 'fill'}
          swatches={
            shape.type === 'note'
              ? NOTE_PAPERS.map((paper) => ({ color: paper.color, label: t(paper.labelKey) }))
              : undefined
          }
          onChange={(fill) => patch({ fill })}
        />
        <FillField
          label={colour.label}
          value={shape.fill}
          fallback={colour.fallback}
          onChange={(fill) => patch({ fill })}
        />
      </Section>

      {shape.type === 'item' && (
        <Section title={t('inspector.meta')}>
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
            dark={ui.dark}
            onChange={(v) => patchMeta({ environment: v as NodeMeta['environment'] })}
          />
          <ChoiceField
            label={t('inspector.criticality')}
            value={shape.meta?.criticality}
            options={CRITICALITIES}
            unset={t('inspector.unset')}
            dark={ui.dark}
            onChange={(v) => patchMeta({ criticality: v as NodeMeta['criticality'] })}
          />
          <ChoiceField
            label={t('inspector.lifecycle')}
            value={shape.meta?.lifecycle}
            options={LIFECYCLES}
            unset={t('inspector.unset')}
            dark={ui.dark}
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
        {/* Items and frames take their size from the group that lays them out,
          so only their place is theirs to set; groups and boundaries own both. */}
        <div className="position-fields">
          <NumberField
            label="X"
            value={Math.round(shape.x)}
            onCommit={(x) =>
              dispatch({
                type: 'moveShapes',
                ids: [shape.id],
                dx: x - shape.x,
                dy: 0,
                viewId: ui.activeViewId,
                drillPath: ui.drillPath,
                coalesceKey: stepKey(shape.id, ['x']),
              })
            }
          />
          <NumberField
            label="Y"
            value={Math.round(shape.y)}
            onCommit={(y) =>
              dispatch({
                type: 'moveShapes',
                ids: [shape.id],
                dx: 0,
                dy: y - shape.y,
                viewId: ui.activeViewId,
                drillPath: ui.drillPath,
                coalesceKey: stepKey(shape.id, ['y']),
              })
            }
          />
          <NumberField
            label="W"
            value={Math.round(shape.w)}
            min={40}
            disabled={shape.type === 'item' || shape.type === 'container'}
            onCommit={(w) =>
              dispatch({
                type: 'resizeShape',
                id: shape.id,
                w,
                h: shape.h,
                viewId: ui.activeViewId,
                coalesceKey: stepKey(shape.id, ['w']),
              })
            }
          />
          <NumberField
            label="H"
            value={Math.round(shape.h)}
            min={40}
            disabled={shape.type === 'item' || shape.type === 'container'}
            onCommit={(h) =>
              dispatch({
                type: 'resizeShape',
                id: shape.id,
                w: shape.w,
                h,
                viewId: ui.activeViewId,
                coalesceKey: stepKey(shape.id, ['h']),
              })
            }
          />
        </div>
        {shape.type === 'item' &&
          (() => {
            // Reordering means something only among siblings: the buttons say
            // so, and are disabled — with the reason — when there is one card.
            const siblings = view.shapes
              .filter((s) => s.type === 'item' && s.parentId === shape.parentId)
              .sort((a, b) => a.y - b.y);
            const index = siblings.findIndex((s) => s.id === shape.id);
            const alone = siblings.length < 2;
            const reorder = (dir: 1 | -1) =>
              dispatch({
                type: 'reorderItem',
                id: shape.id,
                dir,
                viewId: ui.activeViewId,
                drillPath: ui.drillPath,
              });
            return (
              <div className="button-row" title={alone ? t('inspector.reorderAlone') : undefined}>
                <button
                  type="button"
                  className="button"
                  disabled={alone || index <= 0}
                  onClick={() => reorder(-1)}
                >
                  {t('inspector.moveUp')}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={alone || index >= siblings.length - 1}
                  onClick={() => reorder(1)}
                >
                  {t('inspector.moveDown')}
                </button>
                {alone && <p className="inspector-note is-inline">{t('inspector.reorderAlone')}</p>}
              </div>
            );
          })()}
      </Section>

      <div className="inspector-actions">
        <button
          type="button"
          className="button is-danger"
          onClick={() => {
            dispatch({ type: 'deleteShapes', ids: selectedIds });
            dispatchUi({ type: 'clearSelection' });
          }}
        >
          <TrashIcon size={14} /> {t('action.delete')}
        </button>
      </div>
    </aside>
  );
}
