import { describe, expect, it } from 'vitest';
import { addGroup, createEmptyModel } from '@/lib/engine';
import { DropImportError, readDroppedFile, titleFromFileName } from './dropImport';

const K8S = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: payments
spec:
  template:
    spec:
      containers:
        - name: checkout
          image: registry.internal/checkout:2.4.1
---
apiVersion: v1
kind: Service
metadata:
  name: checkout-svc
  namespace: payments
spec:
  selector:
    app: checkout
`;

describe('titleFromFileName', () => {
  it('drops the extension and falls back when nothing is left', () => {
    expect(titleFromFileName('payments platform.yaml')).toBe('payments platform');
    expect(titleFromFileName('arch.tar.gz')).toBe('arch.tar');
    expect(titleFromFileName('.json')).toBe('Imported');
  });
});

describe('readDroppedFile', () => {
  it('reads a project export, a stored record and a workspace dump', () => {
    const model = createEmptyModel();
    addGroup(model, 0, 0);
    const project = readDroppedFile('my arch.json', JSON.stringify(model), 'en');
    expect(project).toMatchObject({ kind: 'diagram', title: 'my arch', format: 'json' });
    expect(project.kind === 'diagram' && project.model.shapes).toHaveLength(3);

    const record = readDroppedFile(
      'x.json',
      JSON.stringify({ id: 'dgm_1', title: 'Stored', model }),
      'en',
    );
    expect(record).toMatchObject({ kind: 'diagram', title: 'Stored' });

    const dump = readDroppedFile(
      'workspace.json',
      JSON.stringify({ exportedAt: 'T', diagrams: [], versions: [] }),
      'en',
    );
    expect(dump).toMatchObject({ kind: 'workspace', data: { diagrams: [], versions: [] } });
  });

  it('reads the DSL, Mermaid and infrastructure', () => {
    const dsl = readDroppedFile(
      'arch.yaml',
      'cloud: aws\nnodes:\n  fn: lambda\n  db: dynamodb\nedges:\n  - fn -> db: R/W\n',
      'en',
    );
    expect(dsl).toMatchObject({ kind: 'diagram', title: 'arch', format: 'dsl' });
    expect(dsl.kind === 'diagram' && dsl.model.connectors).toHaveLength(1);

    const mermaid = readDroppedFile(
      'flow.mmd',
      'flowchart TD\n  a["Lambda"]\n  b["DynamoDB"]\n  a --> b\n',
      'en',
    );
    expect(mermaid).toMatchObject({ kind: 'diagram', format: 'mermaid' });

    const k8s = readDroppedFile('deploy.yaml', K8S, 'en');
    expect(k8s).toMatchObject({ kind: 'diagram', title: 'deploy', format: 'kubernetes' });
    expect(k8s.kind === 'diagram' && k8s.model.shapes.length).toBeGreaterThan(0);

    const tf = readDroppedFile(
      'main.tf',
      'resource "aws_lambda_function" "fn" {\n  function_name = "fn"\n}\n',
      'en',
    );
    expect(tf).toMatchObject({ kind: 'diagram', format: 'terraform' });
  });

  it('reads a Markdown outline', () => {
    const md = readDroppedFile('notes.md', '# Platform\n\n## API\n- Gateway\n- Lambda\n', 'en');
    expect(md).toMatchObject({ kind: 'diagram', title: 'notes', format: 'markdown' });
  });

  it('refuses what it cannot read, with a reason', () => {
    expect(() => readDroppedFile('a.json', '   ', 'en')).toThrow(DropImportError);
    expect(() => readDroppedFile('a.json', '{nope', 'en')).toThrowError(
      expect.objectContaining({ code: 'unreadable' }),
    );
    expect(() => readDroppedFile('a.json', '{"hello":"world"}', 'en')).toThrowError(
      expect.objectContaining({ code: 'unrecognised' }),
    );
    expect(() => readDroppedFile('a.bin', 'random words with no structure', 'en')).toThrowError(
      expect.objectContaining({ code: 'unrecognised' }),
    );
  });
});
