import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from './cli';

/**
 * The CLI is tested through `main`, not by spawning it.
 *
 * Spawning would test Node's module resolution as much as the tool, be slow,
 * and make an assertion about output into an assertion about a subprocess. The
 * launcher is four lines; everything worth checking is here.
 */

let dir: string;
let out: string[];
let err: string[];

const write = async (name: string, body: string) => {
  const path = join(dir, name);
  await writeFile(path, body, 'utf8');
  return path;
};

const CLEAN = `version: 1
cloud: aws
nodes:
  gateway: {service: apigateway, owner: platform}
  checkout: {service: lambda, owner: payments}
  orders: {service: dynamodb, owner: payments}
edges:
  - gateway -> checkout: HTTPS
  - checkout -> orders: R/W
`;

/** Clean by every check there is, which takes some doing. */
const PAIR = `version: 1
cloud: aws
nodes:
  gateway: {service: apigateway, owner: platform}
  checkout: {service: lambda, owner: payments}
edges:
  - gateway -> checkout: HTTPS
`;

const HCL = `resource "aws_lambda_function" "checkout" {
  environment { variables = { TABLE = aws_dynamodb_table.orders.name } }
}
resource "aws_dynamodb_table" "orders" { name = "orders" }
resource "aws_s3_bucket" "loose" { bucket = "nothing-points-at-me" }
`;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ac-graph-cli-'));
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const stdout = () => out.join('');
const stderr = () => err.join('');

describe('finding its feet', () => {
  it('prints the usage and fails when told nothing', async () => {
    expect(await main([])).toBe(1);
    expect(stdout()).toContain('ac-graph');
  });

  it('prints the usage and succeeds when asked for it', async () => {
    expect(await main(['--help'])).toBe(0);
  });

  it('refuses a command it does not have', async () => {
    expect(await main(['frobnicate', 'x'])).toBe(1);
    expect(stderr()).toContain('frobnicate');
  });

  it('says which file it wanted', async () => {
    expect(await main(['check'])).toBe(1);
    expect(stderr()).toContain('needs a file');
  });

  it('reports a missing file rather than throwing at the shell', async () => {
    expect(await main(['check', join(dir, 'nope.yaml')])).toBe(1);
    expect(stderr()).toContain('ENOENT');
  });

  it('refuses a severity that is not one', async () => {
    const path = await write('a.yaml', CLEAN);
    expect(await main(['check', path, '--fail-on', 'catastrophic'])).toBe(1);
    expect(stderr()).toContain('--fail-on');
  });
});

describe('check, which is the point of the whole thing', () => {
  it('reads a DSL document and scores it', async () => {
    const path = await write('a.yaml', CLEAN);
    await main(['check', path]);
    expect(stdout()).toMatch(/\d+\/100/);
  });

  it('reads infrastructure without being told what it is', async () => {
    // A repository has `main.tf` in it; a pipeline should not need a flag per
    // format to run the same check over everything.
    const path = await write('main.tf', HCL);
    await main(['check', path, '--json']);
    expect(JSON.parse(stdout()).format).toBe('terraform');
  });

  it('passes a build when nothing is serious', async () => {
    const path = await write('main.tf', HCL);
    expect(await main(['check', path])).toBe(0);
  });

  it('fails one when the bar is set where the findings are', async () => {
    const path = await write('main.tf', HCL);
    expect(await main(['check', path, '--fail-on', 'low'])).toBe(1);
  });

  it('ignores what sits below the bar', async () => {
    // This file's only finding is a low one, so a build that only cares about
    // mediums and worse should sail past it.
    const path = await write('main.tf', HCL);
    expect(await main(['check', path, '--fail-on', 'medium'])).toBe(0);
  });

  it('reports without failing when asked to', async () => {
    const path = await write('main.tf', HCL);
    expect(await main(['check', path, '--fail-on', 'low', '--exit-zero'])).toBe(0);
    expect(stdout()).toContain('·');
  });

  it('gives a pipeline kinds and values, never a sentence', async () => {
    const path = await write('main.tf', HCL);
    await main(['check', path, '--json']);
    const report = JSON.parse(stdout());
    // Grepping English prose breaks the day somebody runs it with --lang es.
    expect(report.findings[0]).toHaveProperty('kind');
    expect(report.findings[0]).toHaveProperty('detail');
    expect(JSON.stringify(report)).not.toContain('is connected to nothing');
  });

  it('speaks the language it is asked to', async () => {
    const path = await write('main.tf', HCL);
    await main(['check', path, '--lang', 'es', '--exit-zero', '--fail-on', 'low']);
    expect(stdout()).toContain('servicios');
    expect(stdout()).not.toContain('services');
  });

  it('says so when there is nothing to say', async () => {
    // Two owned services and the link between them: nothing cyclic, nothing
    // orphaned, nothing whose loss splits anything.
    const path = await write('a.yaml', PAIR);
    expect(await main(['check', path, '--fail-on', 'low'])).toBe(0);
    expect(stdout()).toContain('Nothing found');
  });
});

describe('import', () => {
  it('writes a DSL document a person could have written', async () => {
    const path = await write('main.tf', HCL);
    await main(['import', path]);
    expect(stdout()).toContain('nodes:');
    expect(stdout()).toContain('service: lambda');
  });

  it('keeps the warnings off standard output, so redirecting produces a clean file', async () => {
    const path = await write('main.tf', HCL);
    await main(['import', path]);
    expect(stdout()).not.toContain('for_each');
    expect(stderr()).toContain('for_each');
  });

  it('writes to a file when told where', async () => {
    const path = await write('main.tf', HCL);
    const target = join(dir, 'architecture.yaml');
    await main(['import', path, '-o', target]);
    expect(await readFile(target, 'utf8')).toContain('nodes:');
    expect(stdout()).toBe('');
  });

  it('refuses something that is not infrastructure', async () => {
    const path = await write('notes.txt', 'just some prose');
    expect(await main(['import', path])).toBe(1);
  });
});

describe('diff', () => {
  it('passes when nothing changed', async () => {
    const a = await write('a.yaml', CLEAN);
    expect(await main(['diff', a, a])).toBe(0);
    expect(stdout()).toContain('No change');
  });

  it('fails, and says what moved, when something did', async () => {
    const a = await write('a.yaml', CLEAN);
    const b = await write(
      'b.yaml',
      CLEAN.replace('orders: {service: dynamodb', 'orders: {service: rds'),
    );
    expect(await main(['diff', a, b])).toBe(1);
    expect(stdout()).toMatch(/[+-]/);
  });

  it('reports without failing when asked to', async () => {
    const a = await write('a.yaml', CLEAN);
    const b = await write('b.yaml', CLEAN.replace('dynamodb', 'rds'));
    expect(await main(['diff', a, b, '--exit-zero'])).toBe(0);
  });

  it('compares infrastructure against a document, both being architectures', async () => {
    const a = await write('main.tf', HCL);
    const b = await write('b.yaml', CLEAN);
    expect(await main(['diff', a, b])).toBe(1);
  });

  it('needs two files', async () => {
    const a = await write('a.yaml', CLEAN);
    expect(await main(['diff', a])).toBe(1);
    expect(stderr()).toContain('two files');
  });
});

describe('mermaid and fmt', () => {
  it('draws a flowchart Git hosts render themselves', async () => {
    const path = await write('a.yaml', CLEAN);
    await main(['mermaid', path]);
    expect(stdout()).toContain('flowchart TD');
  });

  it('rewrites a document in place, which is what a hook needs', async () => {
    const path = await write('a.yaml', `${CLEAN}\n\n\n`);
    expect(await main(['fmt', path])).toBe(0);
    const written = await readFile(path, 'utf8');
    expect(written).not.toMatch(/\n\n\n$/);
    expect(written).toContain('nodes:');
  });

  it('is idempotent, or it would fight the hook it runs in', async () => {
    const path = await write('a.yaml', CLEAN);
    await main(['fmt', path]);
    const once = await readFile(path, 'utf8');
    await main(['fmt', path]);
    expect(await readFile(path, 'utf8')).toBe(once);
  });
});

describe('standards, which are the team’s own rules made executable', () => {
  const STANDARDS = `version: 1
rules:
  - id: prod-needs-owner
    description: Every production service names a team.
    services: {environment: prod}
    require: {owner: true}
  - id: ledger-is-private
    description: Only payments talks to the ledger.
    links: {to: {tag: database}}
    forbid: true
    except: {from: {owner: payments}}
`;

  const PROD = `version: 1
cloud: aws
nodes:
  payments: {service: lambda, label: Payments, owner: payments, environment: prod}
  reporting: {service: lambda, label: Reporting, environment: prod}
  ledger: {service: rds, label: Ledger, owner: payments, environment: prod, tags: [database]}
edges:
  - {from: payments, to: ledger, label: SQL}
  - {from: reporting, to: ledger, label: SQL}
`;

  it('fails a build on a broken standard', async () => {
    const path = await write('a.yaml', PROD);
    const rules = await write('rules.yaml', STANDARDS);
    expect(await main(['check', path, '--rules', rules])).toBe(1);
  });

  it("says the team's own sentence, not a generated one", async () => {
    const path = await write('a.yaml', PROD);
    const rules = await write('rules.yaml', STANDARDS);
    await main(['check', path, '--rules', rules, '--exit-zero']);
    expect(stdout()).toContain('Only payments talks to the ledger.');
    expect(stdout()).toContain('[ledger-is-private]');
  });

  it('names the field a requirement failed on', async () => {
    const path = await write('a.yaml', PROD);
    const rules = await write('rules.yaml', STANDARDS);
    await main(['check', path, '--rules', rules, '--exit-zero']);
    expect(stdout()).toContain('Reporting — owner');
  });

  it('checks the standards a document declares, with no file at all', async () => {
    // Rules travel with the architecture, so a shared file is an addition
    // rather than the only way to have any.
    const path = await write(
      'a.yaml',
      `${PROD}rules:\n  - {id: own, description: Everything has an owner., services: {}, require: {owner: true}}\n`,
    );
    expect(await main(['check', path])).toBe(1);
    expect(stdout()).toContain('Everything has an owner.');
  });

  it('checks both at once, the document’s and the organisation’s', async () => {
    const path = await write(
      'a.yaml',
      `${PROD}rules:\n  - {id: own, description: Mine., services: {}, require: {owner: true}}\n`,
    );
    const rules = await write('rules.yaml', STANDARDS);
    await main(['check', path, '--rules', rules, '--exit-zero']);
    expect(stdout()).toContain('Mine.');
    expect(stdout()).toContain('Only payments talks to the ledger.');
  });

  it('reports a rule that matched nothing rather than counting it as passed', async () => {
    const path = await write('a.yaml', PROD);
    const rules = await write(
      'rules.yaml',
      'rules:\n  - {id: typo, description: T., services: {environment: producton}, require: {owner: true}}',
    );
    expect(await main(['check', path, '--rules', rules])).toBe(0);
    expect(stdout()).toContain('typo');
  });

  it('refuses a rules file it cannot read, rather than checking nothing', async () => {
    const path = await write('a.yaml', PROD);
    const rules = await write('rules.yaml', 'rules:\n  - {id: x, description: X., services: {}}');
    expect(await main(['check', path, '--rules', rules])).toBe(1);
    expect(stderr()).toContain('cannot be read');
  });

  it('gives a pipeline the violations alongside the findings', async () => {
    const path = await write('a.yaml', PROD);
    const rules = await write('rules.yaml', STANDARDS);
    await main(['check', path, '--rules', rules, '--json', '--exit-zero']);
    const report = JSON.parse(stdout());
    expect(report.violations.map((v: { rule: string }) => v.rule)).toContain('ledger-is-private');
    expect(report).toHaveProperty('inertRules');
  });

  it('respects the bar for a violation as it does for a finding', async () => {
    // PAIR is clean by every check there is, so the only thing that can fail
    // this build is the rule — which is what the test is about.
    const path = await write('a.yaml', PAIR);
    const rules = await write(
      'rules.yaml',
      'rules:\n  - {id: soft, description: S., severity: low, services: {}, require: {repository: true}}',
    );
    expect(await main(['check', path, '--rules', rules, '--fail-on', 'medium'])).toBe(0);
    expect(await main(['check', path, '--rules', rules, '--fail-on', 'low'])).toBe(1);
  });
});
