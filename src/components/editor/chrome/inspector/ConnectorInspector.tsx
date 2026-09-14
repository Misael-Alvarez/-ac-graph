'use client';

import { useState } from 'react';
import type { Connector, EdgeMeta, Port } from '@/lib/domain';
import { canvasTheme } from '@/lib/design/tokens';
import { labelAnchor, positionAlong } from '@/lib/editor/connectorPath';
import { protocolLabel } from '@/lib/editor/meta';
import * as E from '@/lib/engine/routing';
import { ConnectorIcon, TrashIcon } from '@/components/icons/ToolIcons';
import { useEditor } from '../../EditorProvider';
import { Field } from '@/components/ui/Field';
import { Section } from '@/components/ui/Section';
import { ChoiceField, DATA_CLASSES, EDGE_KINDS, FillField, PROTOCOLS } from './fields';

/**
 * The inspector for a connection: what it is called, how it is drawn, and what
 * the call means — kind, protocol, data class, authentication — each of which
 * the canvas draws as it is set.
 */
export function ConnectorInspector({
  connector,
  stepKey,
  nextBurst,
}: {
  connector: Connector;
  /** One undo step per visit to a field; see InspectorPanel. */
  stepKey: (id: string, fields: string[]) => string;
  nextBurst: () => void;
}) {
  const { ui, view, dispatch, dispatchUi, t } = useEditor();

  const patchConnector = (values: Partial<typeof connector>) =>
    dispatch({
      type: 'setConnectorProps',
      id: connector.id,
      patch: values,
      coalesceKey: stepKey(connector.id, Object.keys(values)),
    });
  const patchEdgeMeta = (values: Partial<EdgeMeta>) =>
    patchConnector({ meta: { ...connector.meta, ...values } });
  const source = view.shapes.find((s) => s.id === connector.sourceId);
  const target = view.shapes.find((s) => s.id === connector.targetId);
  const automaticAnchor = labelAnchor(connector.waypoints);
  const labelPosition = Math.round(
    (connector.labelAt ??
      (automaticAnchor ? positionAlong(connector.waypoints, automaticAnchor) : 0.5)) * 100,
  );
  const [labelDraft, setLabelDraft] = useState(String(labelPosition));
  const [labelSynced, setLabelSynced] = useState({ id: connector.id, value: labelPosition });
  if (labelSynced.id !== connector.id || labelSynced.value !== labelPosition) {
    setLabelSynced({ id: connector.id, value: labelPosition });
    setLabelDraft(String(labelPosition));
  }
  const labelInvalid =
    labelDraft !== '' &&
    (!Number.isFinite(Number(labelDraft)) || Number(labelDraft) < 0 || Number(labelDraft) > 100);

  return (
    <aside className="inspector" aria-label={t('inspector.title')} onFocus={nextBurst}>
      <header className="inspector-hero">
        <span className="inspector-hero-icon is-connector" aria-hidden="true">
          <ConnectorIcon size={22} />
        </span>
        <div className="inspector-hero-text">
          <input
            className="input inspector-hero-title"
            value={connector.label}
            aria-label={t('inspector.label')}
            placeholder={t('inspector.label')}
            spellCheck={false}
            onChange={(e) => patchConnector({ label: e.target.value })}
          />
          <div className="inspector-hero-meta">
            <span className="inspector-type">{t('inspector.type.connector')}</span>
            {source && target && (
              <span className="inspector-endpoints" title={`${source.title} → ${target.title}`}>
                {source.title} → {target.title}
              </span>
            )}
          </div>
        </div>
      </header>
      <Section title={t('inspector.appearance')}>
        <div className="segmented">
          {(['solid', 'dashed'] as const).map((style) => (
            <button
              key={style}
              type="button"
              className={`segmented-option${connector.style === style ? ' is-active' : ''}`}
              onClick={() => patchConnector({ style })}
            >
              {t(style === 'solid' ? 'inspector.solid' : 'inspector.dashed')}
            </button>
          ))}
        </div>
        <ChoiceField
          label={t('inspector.elbows')}
          value={connector.curve === 'rounded' ? undefined : connector.curve}
          options={['orthogonal']}
          unset={t('inspector.curve.rounded')}
          dark={ui.dark}
          display={() => t('inspector.curve.orthogonal')}
          onChange={(curve) => patchConnector({ curve: curve as Connector['curve'] })}
        />
        <ChoiceField
          label={t('inspector.thickness')}
          value={connector.weight === 'regular' ? undefined : connector.weight}
          options={['thin', 'bold']}
          unset={t('inspector.weight.regular')}
          dark={ui.dark}
          display={(weight) => t(`inspector.weight.${weight as 'thin' | 'bold'}`)}
          onChange={(weight) => patchConnector({ weight: weight as Connector['weight'] })}
        />
        <FillField
          label={t('inspector.color')}
          value={connector.color}
          fallback={canvasTheme(ui.dark).connector}
          onChange={(color) => patchConnector({ color })}
        />
        <div className="button-row">
          <button
            type="button"
            className="button"
            onClick={() => dispatch({ type: 'reverseConnector', id: connector.id })}
          >
            {t('menu.reverse')}
          </button>
        </div>
      </Section>

      <Section title={t('inspector.route')}>
        {(['sourcePort', 'targetPort'] as const).map((port) => (
          <ChoiceField
            key={port}
            label={t(`inspector.${port}`)}
            value={connector[port]}
            options={['N', 'S', 'E', 'W']}
            unset={t('inspector.auto')}
            dark={ui.dark}
            display={(face) => t(`inspector.port.${face as Port}`)}
            onChange={(face) => patchConnector({ [port]: face as Port | undefined })}
          />
        ))}
        <div className="button-row">
          <button
            type="button"
            className="button"
            disabled={!automaticAnchor}
            onClick={() => {
              if (!automaticAnchor) return;
              const { waypoints, index } = E.insertBend(connector.waypoints, automaticAnchor);
              dispatch({
                type: 'setConnectorRoute',
                id: connector.id,
                waypoints,
                viewId: ui.activeViewId,
                coalesceKey: stepKey(connector.id, ['waypoints']),
              });
              requestAnimationFrame(() => {
                document
                  .querySelector<SVGGElement>(`[data-bend-index="${index}"]`)
                  ?.focus({ preventScroll: true });
              });
            }}
          >
            {t('canvas.addBend')}
          </button>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="button"
            disabled={!connector.manual}
            onClick={() => dispatch({ type: 'resetConnectorRoute', id: connector.id })}
          >
            {t('inspector.resetRoute')}
          </button>
        </div>
        <Field label={`${t('canvas.labelPosition')} (%)`}>
          <input
            className={`input${labelInvalid ? ' is-invalid' : ''}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            step={1}
            value={labelDraft}
            aria-label={t('canvas.labelPosition')}
            aria-invalid={labelInvalid || undefined}
            onChange={(e) => {
              setLabelDraft(e.target.value);
              const next = e.target.valueAsNumber;
              if (Number.isFinite(next) && next >= 0 && next <= 100) {
                patchConnector({ labelAt: next / 100 });
              }
            }}
            onBlur={() => setLabelDraft(String(labelPosition))}
          />
        </Field>
        <div className="button-row">
          <button
            type="button"
            className="button"
            disabled={connector.labelAt === undefined}
            onClick={() => patchConnector({ labelAt: undefined })}
          >
            {t('inspector.resetLabelPosition')}
          </button>
        </div>
        <p className="inspector-note">{t('inspector.routeHelp')}</p>
      </Section>

      {/* What the arrow means, as opposed to how it is drawn. `A -> B` says
          almost nothing; whether the call is synchronous, what carries it and
          whether customer data travels along it is what can be checked — and
          what the canvas now draws: the kind as the dash, the protocol as the
          label, the data class and the auth as tags. */}
      <Section title={t('inspector.link')}>
        <ChoiceField
          label={t('inspector.kind')}
          value={connector.meta?.kind}
          options={EDGE_KINDS}
          unset={t('inspector.unset')}
          dark={ui.dark}
          onChange={(v) => patchEdgeMeta({ kind: v as EdgeMeta['kind'] })}
        />
        <ChoiceField
          label={t('inspector.protocol')}
          value={connector.meta?.protocol}
          options={PROTOCOLS}
          unset={t('inspector.unset')}
          dark={ui.dark}
          display={(option) => protocolLabel(option as EdgeMeta['protocol'])}
          onChange={(v) => patchEdgeMeta({ protocol: v as EdgeMeta['protocol'] })}
        />
        <ChoiceField
          label={t('inspector.dataClass')}
          value={connector.meta?.dataClass}
          options={DATA_CLASSES}
          unset={t('inspector.unset')}
          dark={ui.dark}
          onChange={(v) => patchEdgeMeta({ dataClass: v as EdgeMeta['dataClass'] })}
        />
        <Field label={t('inspector.auth')}>
          <input
            className="input"
            value={connector.meta?.auth ?? ''}
            placeholder="OAuth2"
            onChange={(e) => patchEdgeMeta({ auth: e.target.value || undefined })}
          />
        </Field>
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
