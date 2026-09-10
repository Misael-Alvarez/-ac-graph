'use client';

import type { Connector, EdgeMeta } from '@/lib/domain';
import { protocolLabel } from '@/lib/editor/meta';
import { ConnectorIcon, TrashIcon } from '@/components/icons/ToolIcons';
import { useEditor } from '../../EditorProvider';
import { ChoiceField, DATA_CLASSES, EDGE_KINDS, Field, PROTOCOLS, Section } from './fields';

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
      <Section title={t('inspector.content')}>
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
