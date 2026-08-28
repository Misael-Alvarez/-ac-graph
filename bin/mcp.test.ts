import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handle, serve } from './mcp';

let dir: string;

const write = async (name: string, body: string) => {
  const path = join(dir, name);
  await writeFile(path, body, 'utf8');
  return path;
};

const ARCH = `version: 1
cloud: aws
nodes:
  gateway: {service: apigateway, owner: platform}
  checkout: {service: lambda, owner: payments}
  orders: {service: dynamodb, owner: payments}
edges:
  - gateway -> checkout: HTTPS
  - checkout -> orders: R/W
`;

const HCL = `resource "aws_lambda_function" "checkout" {
  environment { variables = { TABLE = aws_dynamodb_table.orders.name } }
}
resource "aws_dynamodb_table" "orders" { name = "orders" }
`;

interface ToolReply {
  result: { content: { text: string }[]; isError?: boolean };
}

/** Calls a tool and returns what it answered, parsed. */
async function call(name: string, args: Record<string, unknown>) {
  const response = (await handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  })) as ToolReply;
  const text = response.result.content[0].text;
  return {
    isError: Boolean(response.result.isError),
    text,
    // An error is a sentence for the agent to read, not JSON.
    data: response.result.isError ? null : JSON.parse(text),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ac-graph-mcp-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the protocol', () => {
  it('introduces itself', async () => {
    const response = (await handle({ jsonrpc: '2.0', id: 1, method: 'initialize' })) as {
      result: { serverInfo: { name: string }; capabilities: object };
    };
    expect(response.result.serverInfo.name).toBe('ac-graph');
    expect(response.result.capabilities).toHaveProperty('tools');
  });

  it('says nothing back to a notification', async () => {
    // A notification carries no id and takes no answer; replying is a protocol
    // error, not a courtesy.
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('lists its tools with schemas', async () => {
    const response = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
      result: { tools: { name: string; description: string; inputSchema: object }[] };
    };
    expect(response.result.tools.length).toBeGreaterThan(4);
    for (const tool of response.result.tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(40);
      expect(tool.inputSchema, tool.name).toHaveProperty('required');
    }
  });

  it('refuses a method it does not have', async () => {
    const response = (await handle({ jsonrpc: '2.0', id: 1, method: 'resources/list' })) as {
      error: { code: number };
    };
    expect(response.error.code).toBe(-32601);
  });

  it('reads a stream of requests and answers each on its own line', async () => {
    const lines: string[] = [];
    const input = (async function* () {
      yield '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,';
      yield '"method":"tools/list"}\n';
    })() as unknown as NodeJS.ReadableStream;
    // The generator has no `setEncoding`; the server calls it, so stub it.
    (input as unknown as { setEncoding: () => void }).setEncoding = () => {};

    await serve(input, {
      write: (chunk: string) => lines.push(chunk),
    } as unknown as NodeJS.WritableStream);

    // A request split across two chunks still arrives whole.
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).result.tools).toBeInstanceOf(Array);
  });
});

describe('reading', () => {
  it('reads a DSL document into services and links', async () => {
    const path = await write('a.yaml', ARCH);
    const { data } = await call('read_architecture', { path });
    expect(data.services.map((s: { name: string }) => s.name)).toEqual([
      'API Gateway',
      'Lambda',
      'DynamoDB',
    ]);
    expect(data.links[0]).toMatchObject({ from: 'API Gateway', to: 'Lambda', label: 'HTTPS' });
  });

  it('reads infrastructure without being told what it is', async () => {
    const path = await write('main.tf', HCL);
    expect((await call('read_architecture', { path })).data.format).toBe('terraform');
  });

  it('carries the metadata through, which is the part worth querying', async () => {
    const path = await write('a.yaml', ARCH);
    const { data } = await call('read_architecture', { path });
    expect(data.services[0].owner).toBe('platform');
  });
});

describe('analysing', () => {
  it('scores and explains, giving both the kind and the sentence', async () => {
    const path = await write('a.yaml', ARCH);
    const { data } = await call('analyze_architecture', { path });
    expect(data.score).toBeGreaterThan(0);
    expect(data.findings[0]).toHaveProperty('kind');
    // An agent reads prose, unlike a pipeline, so it gets a summary too.
    expect(data.findings[0].summary).toContain('Lambda');
  });

  it('answers what breaks if a service goes away', async () => {
    const path = await write('a.yaml', ARCH);
    const { data } = await call('analyze_impact', { path, service: 'Lambda' });
    expect(data.callers).toEqual(['API Gateway']);
    expect(data.calls).toEqual(['DynamoDB']);
    expect(data.splitsArchitecture).toBe(true);
  });

  it('follows the graph rather than only the neighbours', async () => {
    const path = await write('a.yaml', ARCH);
    const { data } = await call('analyze_impact', { path, service: 'API Gateway' });
    expect(data.calls).toEqual(['Lambda']);
    expect(data.reaches).toEqual(expect.arrayContaining(['Lambda', 'DynamoDB']));
  });

  it('names what the architecture does have when asked about something it does not', async () => {
    const path = await write('a.yaml', ARCH);
    const answer = await call('analyze_impact', { path, service: 'Kafka' });
    expect(answer.isError).toBe(true);
    // So the agent can correct itself instead of guessing again.
    expect(answer.text).toContain('API Gateway');
  });
});

describe('searching and comparing', () => {
  it('finds a service by what it does, in either language', async () => {
    // The catalogue search is language-blind on purpose.
    const spanish = await call('search_components', { query: 'cómputo serverless', limit: 5 });
    const english = await call('search_components', { query: 'serverless compute', limit: 5 });
    const keys = (r: typeof spanish) => r.data.services.map((s: { key: string }) => s.key);
    expect(keys(spanish)).toContain('aws-lambda');
    expect(keys(english)).toContain('aws-lambda');
  });

  it('says what moved between two architectures', async () => {
    const before = await write('a.yaml', ARCH);
    const after = await write(
      'b.yaml',
      ARCH.replace('orders: {service: dynamodb', 'orders: {service: rds'),
    );
    const { data } = await call('diff_architecture', { before, after });
    expect(data.identical).toBe(false);
    expect(data.services.length).toBeGreaterThan(0);
  });

  it('says so when nothing moved', async () => {
    const path = await write('a.yaml', ARCH);
    expect((await call('diff_architecture', { before: path, after: path })).data.identical).toBe(
      true,
    );
  });
});

describe('writing', () => {
  it('writes a document and reports what it produced', async () => {
    const path = join(dir, 'new.yaml');
    const { data } = await call('write_architecture', { path, document: ARCH });
    expect(data.services).toBe(3);
    expect(await readFile(path, 'utf8')).toContain('nodes:');
  });

  it('refuses a document that does not compile, before touching the file', async () => {
    const path = join(dir, 'new.yaml');
    const answer = await call('write_architecture', {
      path,
      document: 'version: 1\nnodes:\n  api: {service: not-a-real-service}\n',
    });
    expect(answer.isError).toBe(true);
    // Finding out afterwards would mean having already overwritten a file.
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  it('hands back a Mermaid flowchart for a pull request', async () => {
    const path = await write('a.yaml', ARCH);
    expect((await call('to_mermaid', { path })).data.mermaid).toContain('flowchart TD');
  });
});

describe('failing', () => {
  it('reports a bad file as a tool error the agent can read and retry', async () => {
    const answer = await call('read_architecture', { path: join(dir, 'nope.yaml') });
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain('ENOENT');
  });

  it('refuses a tool it does not have', async () => {
    const answer = await call('delete_everything', {});
    expect(answer.isError).toBe(true);
  });
});

describe('standards', () => {
  const WITH_RULES = `${ARCH}rules:
  - id: prod-needs-owner
    description: Every production service names a team.
    services: {}
    require: {environment: true}
`;

  it('checks the rules a document declares', async () => {
    const path = await write('a.yaml', WITH_RULES);
    const { data } = await call('check_standards', { path });
    expect(data.checked).toBe(1);
    expect(data.violations.length).toBeGreaterThan(0);
  });

  it("hands back the team's own sentence, not one of its own", async () => {
    const path = await write('a.yaml', WITH_RULES);
    const { data } = await call('check_standards', { path });
    expect(data.violations[0].says).toBe('Every production service names a team.');
  });

  it('takes a shared rules file on top of them', async () => {
    const path = await write('a.yaml', WITH_RULES);
    const rules = await write(
      'rules.yaml',
      'rules:\n  - {id: shared, description: Shared., services: {}, require: {repository: true}}',
    );
    const { data } = await call('check_standards', { path, rules });
    expect(data.checked).toBe(2);
    expect(data.violations.map((v: { rule: string }) => v.rule)).toContain('shared');
  });

  it('separates the rules that matched nothing', async () => {
    const path = await write('a.yaml', ARCH);
    const rules = await write(
      'rules.yaml',
      'rules:\n  - {id: typo, description: T., services: {environment: producton}, require: {owner: true}}',
    );
    const { data } = await call('check_standards', { path, rules });
    expect(data.rulesThatMatchedNothing).toEqual(['typo']);
    expect(data.violations).toEqual([]);
  });

  it('refuses a rules file it cannot read', async () => {
    const path = await write('a.yaml', ARCH);
    const rules = await write('rules.yaml', 'rules:\n  - {id: x, description: X., services: {}}');
    const answer = await call('check_standards', { path, rules });
    expect(answer.isError).toBe(true);
  });
});
