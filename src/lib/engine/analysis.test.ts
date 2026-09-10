import { describe, expect, it } from 'vitest';
import type { DiagramModel } from '@/lib/domain';
import { analyzeArchitecture, type FindingKind } from './analysis';
import { createEmptyModel } from './model';

/**
 * Builds a model of loose items and connectors.
 *
 * Deliberately not `addGroup`: these tests are about the graph, and wrapping
 * every node in a group and a container would bury the shape under geometry
 * that has nothing to do with what is being asserted.
 */
function graph(nodes: string[], edges: [string, string][]): DiagramModel {
  const model = createEmptyModel();
  model.shapes = nodes.map((id) => ({
    id,
    type: 'item' as const,
    parentId: null,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    title: id,
  }));
  model.connectors = edges.map(([sourceId, targetId], i) => ({
    id: `c${i}`,
    sourceId,
    targetId,
    label: '',
    style: 'solid' as const,
    waypoints: [],
  }));
  return model;
}

const kinds = (model: DiagramModel): FindingKind[] =>
  analyzeArchitecture(model).findings.map((f) => f.kind);

const of = (model: DiagramModel, kind: FindingKind) =>
  analyzeArchitecture(model).findings.filter((f) => f.kind === kind);

describe('circular dependencies', () => {
  it('finds a cycle the eye would miss', () => {
    //  a → b → c → a,  and d hanging off c
    const model = graph(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
        ['c', 'd'],
      ],
    );
    const [cycle] = of(model, 'cycle');
    expect(cycle.shapeIds.sort()).toEqual(['a', 'b', 'c']);
    expect(cycle.severity).toBe('high');
  });

  it('does not call a plain chain a cycle', () => {
    const model = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    expect(kinds(model)).not.toContain('cycle');
  });

  it('ignores an arrow from a node to itself', () => {
    const model = graph(['a', 'b'], [['a', 'a']]);
    expect(kinds(model)).not.toContain('cycle');
  });
});

describe('single points of failure', () => {
  it('names the node whose loss splits the architecture', () => {
    //  a → b → c :  b is the only way across
    const model = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    const spofs = of(model, 'singlePointOfFailure');
    expect(spofs.map((f) => f.shapeIds[0])).toEqual(['b']);
  });

  it('says nothing when there is a way around', () => {
    //  a → b → c and a → c :  losing b leaves a and c connected
    const model = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['a', 'c'],
      ],
    );
    expect(kinds(model)).not.toContain('singlePointOfFailure');
  });

  it('raises the severity when the node is marked critical', () => {
    const model = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    model.shapes[1].meta = { criticality: 'critical' };
    expect(of(model, 'singlePointOfFailure')[0].severity).toBe('high');
  });
});

describe('the rest of the checks', () => {
  it('reports a node nothing reaches', () => {
    const model = graph(['a', 'b', 'lonely'], [['a', 'b']]);
    expect(of(model, 'orphan').map((f) => f.shapeIds[0])).toEqual(['lonely']);
  });

  it('reports a node everything hangs off', () => {
    const model = graph(
      ['hub', 'a', 'b', 'c', 'd'],
      [
        ['a', 'hub'],
        ['b', 'hub'],
        ['c', 'hub'],
        ['hub', 'd'],
      ],
    );
    const [coupling] = of(model, 'highCoupling');
    expect(coupling.shapeIds).toEqual(['hub']);
    expect(coupling.detail.degree).toBe(4);
  });

  it('asks who owns what only once somebody has answered', () => {
    const model = graph(['a', 'b'], [['a', 'b']]);
    // Nobody has started filling owners in: the question is noise.
    expect(kinds(model)).not.toContain('unowned');

    model.shapes[0].meta = { owner: 'payments' };
    expect(of(model, 'unowned').map((f) => f.shapeIds[0])).toEqual(['b']);
  });

  it('reports customer data travelling without authentication', () => {
    const model = graph(['api', 'db'], [['api', 'db']]);
    model.connectors[0].meta = { dataClass: 'pii' };
    const [finding] = of(model, 'unauthenticatedData');
    expect(finding.connectorIds).toEqual(['c0']);

    model.connectors[0].meta = { dataClass: 'pii', auth: 'mTLS' };
    expect(kinds(model)).not.toContain('unauthenticatedData');
  });
});

describe('the score', () => {
  it('is whole for a clean architecture', () => {
    const model = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['a', 'c'],
      ],
    );
    const result = analyzeArchitecture(model);
    expect(result.findings).toEqual([]);
    expect(result.score).toBe(100);
    expect(result.nodes).toBe(3);
  });

  it('comes down by the weight of what was found, and never below zero', () => {
    const model = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    // One articulation point, worth five.
    expect(analyzeArchitecture(model).score).toBe(95);

    const wrecked = graph(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b'],
        ['b', 'a'],
        ['c', 'd'],
        ['d', 'c'],
      ],
    );
    expect(analyzeArchitecture(wrecked).score).toBeLessThan(95);
    expect(analyzeArchitecture(wrecked).score).toBeGreaterThanOrEqual(0);
  });

  it('has nothing to say about an empty diagram', () => {
    const result = analyzeArchitecture(createEmptyModel());
    expect(result.findings).toEqual([]);
    expect(result.nodes).toBe(0);
  });

  it('puts the worst first', () => {
    const model = graph(
      ['a', 'b', 'c', 'lonely'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ],
    );
    const [first] = analyzeArchitecture(model).findings;
    expect(first.severity).toBe('high');
  });
});

describe('ordering', () => {
  it('lists equal findings in the same order however the ids were minted', async () => {
    const { TEMPLATES } = await import('@/lib/editor/templates');
    const build = () => TEMPLATES.find((t) => t.id === 'microservices')!.build('es');
    const a = analyzeArchitecture(build());
    const b = analyzeArchitecture(build());
    const summary = (analysis: typeof a) =>
      analysis.findings.map((f) => `${f.severity}:${f.kind}:${JSON.stringify(f.detail)}`);
    expect(summary(a)).toEqual(summary(b));
  });
});
