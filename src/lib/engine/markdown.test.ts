import { describe, expect, it } from 'vitest';
import { exportToMarkdown } from './markdown';
import { addDecoration, addGroup, children, createEmptyModel } from './model';
import { addConnector } from './routing';

function groupNamed(m: ReturnType<typeof createEmptyModel>, title: string, itemTitle: string) {
  const g = addGroup(m, 0, 0);
  g.title = title;
  const ct = children(m, g.id).find((s) => s.type === 'container')!;
  const item = children(m, ct.id)[0];
  item.title = itemTitle;
  item.subtitle = '';
  return { group: g, item };
}

describe('exportToMarkdown', () => {
  it('lists services grouped by their group title', () => {
    const m = createEmptyModel();
    groupNamed(m, 'Frontend', 'CloudFront');
    const md = exportToMarkdown(m);
    expect(md).toContain('## Services');
    expect(md).toContain('### Frontend');
    expect(md).toContain('- CloudFront');
  });

  it('writes the notes and texts as they were typed, and no region', () => {
    const m = createEmptyModel();
    groupNamed(m, 'Compute', 'Lambda');
    addDecoration(m, 'note', 0, 0, '**Todo**\n- migrate');
    addDecoration(m, 'text', 0, 0, '# Phase 2');
    addDecoration(m, 'region', 0, 0, 'DMZ');
    addDecoration(m, 'note', 0, 0, '');
    const md = exportToMarkdown(m);
    expect(md).toContain('## Notes\n\n**Todo**\n- migrate\n\n# Phase 2\n');
    expect(md).not.toContain('DMZ');
    expect(exportToMarkdown(createEmptyModel())).not.toContain('## Notes');
  });

  it('appends the subtitle after an em dash', () => {
    const m = createEmptyModel();
    const { item } = groupNamed(m, 'Compute', 'Lambda');
    item.subtitle = 'Serverless compute';
    expect(exportToMarkdown(m)).toContain('- Lambda — Serverless compute');
  });

  it('renders connections with their labels', () => {
    const m = createEmptyModel();
    const a = groupNamed(m, 'A', 'API Gateway');
    const b = groupNamed(m, 'B', 'Lambda');
    const c = addConnector(m, a.item.id, b.item.id);
    c.label = 'Invoke';
    const md = exportToMarkdown(m);
    expect(md).toContain('## Connections');
    expect(md).toContain('API Gateway -> Lambda : Invoke');
  });

  it('omits the label separator when there is no label', () => {
    const m = createEmptyModel();
    const a = groupNamed(m, 'A', 'One');
    const b = groupNamed(m, 'B', 'Two');
    addConnector(m, a.item.id, b.item.id);
    expect(exportToMarkdown(m)).toContain('One -> Two');
    expect(exportToMarkdown(m)).not.toContain('One -> Two :');
  });

  it('names each boundary as a heading', () => {
    const m = createEmptyModel();
    m.shapes.push({
      id: 'bd',
      type: 'boundary',
      parentId: null,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      title: 'AWS Cloud',
    });
    expect(exportToMarkdown(m)).toContain('## AWS Cloud');
  });

  it('skips empty groups', () => {
    const m = createEmptyModel();
    const g = addGroup(m, 0, 0);
    g.title = 'Empty';
    const ct = children(m, g.id).find((s) => s.type === 'container')!;
    m.shapes = m.shapes.filter((s) => s.parentId !== ct.id);
    expect(exportToMarkdown(m)).not.toContain('### Empty');
  });

  it('produces just the header for an empty diagram', () => {
    expect(exportToMarkdown(createEmptyModel())).toBe('# Architecture Diagram\n\n## Services\n');
  });
});
