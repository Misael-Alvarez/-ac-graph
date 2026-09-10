import type { DiagramModel } from '@/lib/domain';
import { getShape } from '@/lib/engine';
import type { MessageKey } from '@/lib/i18n/messages';
import { connectorLabel } from './meta';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Enough to know what is on the canvas, not so much that a screen reader drones. */
const MAX_GROUPS = 12;
const MAX_SERVICES_PER_GROUP = 8;
const MAX_CONNECTIONS = 20;

/**
 * The diagram as one paragraph a screen reader can speak.
 *
 * The canvas is an SVG of positioned rectangles — to assistive technology it is
 * a picture. This says what the picture says: how many things there are, which
 * services sit in which group, and who calls whom. Localised through `t`, and
 * the same text goes into the exported SVG's `<desc>`, so an image pasted into
 * a document keeps its meaning.
 */
export function describeDiagram(model: DiagramModel, t: Translate): string {
  const groups = model.shapes.filter((shape) => shape.type === 'group');
  const items = model.shapes.filter((shape) => shape.type === 'item');
  if (model.shapes.length === 0) return t('a11y.empty');

  const parts = [
    t('a11y.summary', {
      groups: groups.length,
      services: items.length,
      connections: model.connectors.length,
    }),
  ];

  const groupTexts = groups.slice(0, MAX_GROUPS).map((group) => {
    const inside = items.filter((item) => {
      const container = item.parentId ? getShape(model, item.parentId) : undefined;
      return container?.parentId === group.id;
    });
    const names = inside
      .slice(0, MAX_SERVICES_PER_GROUP)
      .map((item) => item.title || t('a11y.untitled'));
    if (inside.length > MAX_SERVICES_PER_GROUP) {
      names.push(t('a11y.more', { count: inside.length - MAX_SERVICES_PER_GROUP }));
    }
    const title = group.title || t('a11y.untitled');
    return inside.length ? `${title} (${names.join(', ')})` : title;
  });
  if (groups.length > MAX_GROUPS)
    groupTexts.push(t('a11y.more', { count: groups.length - MAX_GROUPS }));
  if (groupTexts.length) parts.push(t('a11y.groups', { list: groupTexts.join('; ') }));

  const connectionTexts: string[] = [];
  for (const connector of model.connectors) {
    if (connectionTexts.length >= MAX_CONNECTIONS) break;
    const source = getShape(model, connector.sourceId);
    const target = getShape(model, connector.targetId);
    if (!source || !target) continue;
    const label = connectorLabel(connector);
    const from = source.title || t('a11y.untitled');
    const to = target.title || t('a11y.untitled');
    connectionTexts.push(
      label ? t('a11y.callLabelled', { from, to, label }) : t('a11y.call', { from, to }),
    );
  }
  if (model.connectors.length > MAX_CONNECTIONS) {
    connectionTexts.push(t('a11y.more', { count: model.connectors.length - MAX_CONNECTIONS }));
  }
  if (connectionTexts.length)
    parts.push(t('a11y.connections', { list: connectionTexts.join('; ') }));

  return parts.join(' ');
}
