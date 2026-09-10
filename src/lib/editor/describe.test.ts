import { describe, expect, it } from 'vitest';
import { addConnector, addGroup, createEmptyModel } from '@/lib/engine';
import { translate } from '@/lib/i18n/messages';
import { describeDiagram } from './describe';

const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) =>
  translate('en', key, values);

describe('describeDiagram', () => {
  it('says the canvas is empty when it is', () => {
    expect(describeDiagram(createEmptyModel(), t)).toBe('Empty canvas.');
  });

  it('counts, then lists groups with their services and the calls between them', () => {
    const model = createEmptyModel();
    addGroup(model, 0, 0);
    addGroup(model, 600, 0);
    const [a, b] = model.shapes.filter((shape) => shape.type === 'group');
    a.title = 'API';
    b.title = 'Data';
    const items = model.shapes.filter((shape) => shape.type === 'item');
    items[0].title = 'Gateway';
    items[1].title = 'Postgres';
    addConnector(model, items[0].id, items[1].id);
    model.connectors[0].label = 'SQL';

    const text = describeDiagram(model, t);
    expect(text).toBe(
      'Diagram with 2 groups, 2 services and 1 connections. Groups: API (Gateway); Data (Postgres). Connections: Gateway to Postgres (SQL).',
    );
  });

  it('caps long lists and says how many more there are', () => {
    const model = createEmptyModel();
    for (let i = 0; i < 15; i++) addGroup(model, i * 500, 0);
    const text = describeDiagram(model, t);
    expect(text).toContain('and 3 more');
    expect(text.split(';').length).toBeLessThanOrEqual(14);
  });

  it('speaks the reader\u2019s language', () => {
    const model = createEmptyModel();
    addGroup(model, 0, 0);
    const es = describeDiagram(model, (key, values) => translate('es', key, values));
    expect(es.startsWith('Diagrama con 1 grupos, 1 servicios y 0 conexiones.')).toBe(true);
  });
});
