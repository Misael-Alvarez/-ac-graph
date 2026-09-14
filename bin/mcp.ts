import { readFile, writeFile } from 'node:fs/promises';
import { compile, parseDsl, serializeDsl, toMermaid } from '@/lib/dsl';
import { FINDING_HEADLINE, analyzeArchitecture, diffModels, getShape } from '@/lib/engine';
import type { DiagramModel, Shape } from '@/lib/domain';
import { detectFormat, importArchitecture } from '@/lib/import';
import { checkRules, parseRules } from '@/lib/rules';
import { queryCatalog } from '@/lib/editor/catalog';
import { translate } from '@/lib/i18n/messages';

/**
 * The architecture, as tools an agent can call.
 *
 * The study's argument for this is that an architecture nobody can query is an
 * architecture that only its author understands. An agent working in a
 * repository should be able to ask what depends on the payments service before
 * it changes it, and be told from the model rather than from a guess about the
 * code.
 *
 * Speaks MCP over stdio directly — the protocol's surface here is three methods
 * and the SDK would be a dependency for the sake of a switch statement. Every
 * tool is a thin wrapper over the same library the editor and the CLI use.
 */

const PROTOCOL_VERSION = '2024-11-05';

interface Request {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'read_architecture',
    description:
      'Read an architecture from a file. Accepts the AC Graph DSL, a Terraform plan or HCL, ' +
      'a CloudFormation or SAM template, Kubernetes manifests, a Docker Compose file, a Pulumi ' +
      'stack export or preview, or an OpenAPI description — it works out which. Returns the ' +
      'services, what connects to what, and the metadata each carries.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File to read.' } },
      required: ['path'],
    },
  },
  {
    name: 'analyze_architecture',
    description:
      'Check an architecture for cycles, single points of failure, orphans, high coupling, ' +
      'unowned services and unauthenticated data flows. Returns a score out of 100 and the ' +
      'findings behind it. This is the same analysis the editor shows and the CLI fails a build on.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'analyze_impact',
    description:
      'What breaks if one service goes away: everything reachable from it, everything that ' +
      'reaches it, and whether losing it splits the architecture. Ask this before changing a service.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        service: { type: 'string', description: 'Name of the service, as the diagram calls it.' },
      },
      required: ['path', 'service'],
    },
  },
  {
    name: 'search_components',
    description:
      'Search the catalogue of 572 cloud services across AWS, Azure, GCP, OCI and IBM. ' +
      'Use it to find the right service key before writing a document.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', description: 'Default 20.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'diff_architecture',
    description:
      'What changed between two architectures. Identity survives a rename or a recompile, ' +
      'so this reports what actually moved rather than "everything was replaced".',
    inputSchema: {
      type: 'object',
      properties: { before: { type: 'string' }, after: { type: 'string' } },
      required: ['before', 'after'],
    },
  },
  {
    name: 'write_architecture',
    description:
      'Write an AC Graph DSL document to a file, after checking it compiles. Use this to ' +
      'propose a change: the result says what the document produced and what the analysis makes of it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        document: { type: 'string', description: 'The DSL source.' },
      },
      required: ['path', 'document'],
    },
  },
  {
    name: 'check_standards',
    description:
      'Check an architecture against the rules it declares, and optionally a shared rules ' +
      "file. Returns which standards are broken, by what, and the rule's own wording. Rules " +
      'that matched nothing come back separately, since those pass for the wrong reason.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        rules: {
          type: 'string',
          description: 'A rules file, on top of any the document declares.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'to_mermaid',
    description:
      'Render an architecture as a Mermaid flowchart, which GitHub and GitLab draw natively. ' +
      'Use it to put a diagram in a pull request or a README.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

/** Reads a file into a model, whatever format it is in. */
async function readModel(path: string): Promise<{ model: DiagramModel; format: string }> {
  const source = await readFile(path, 'utf8');
  const infrastructure = detectFormat(source);
  if (infrastructure) {
    const imported = importArchitecture(source, infrastructure);
    return { model: compile(imported.document).model, format: infrastructure };
  }
  const parsed = parseDsl(source);
  if (!parsed.model || parsed.diagnostics.some((d) => d.severity === 'error')) {
    throw new Error(
      `${path} is not a readable architecture: ` +
        parsed.diagnostics
          .filter((d) => d.severity === 'error')
          .map((d) => d.message)
          .join('; '),
    );
  }
  return { model: parsed.model, format: 'dsl' };
}

const nameOf = (shape: Shape) => shape.title || shape.icon?.key || shape.id;

/** The services of a model, flat, which is what an agent wants rather than shapes. */
function servicesOf(model: DiagramModel) {
  return model.shapes
    .filter((s) => s.type === 'item')
    .map((s) => ({
      id: s.id,
      name: nameOf(s),
      service: s.icon?.key,
      ...s.meta,
    }));
}

function linksOf(model: DiagramModel) {
  const byId = new Map(model.shapes.map((s) => [s.id, s]));
  return model.connectors.map((c) => ({
    from: nameOf(byId.get(c.sourceId) ?? ({ id: c.sourceId } as Shape)),
    to: nameOf(byId.get(c.targetId) ?? ({ id: c.targetId } as Shape)),
    label: c.label || undefined,
    ...c.meta,
  }));
}

/** The item whose name an agent gave, matched the way a person would mean it. */
function findService(model: DiagramModel, name: string): Shape {
  const needle = name.trim().toLowerCase();
  const items = model.shapes.filter((s) => s.type === 'item');
  const found =
    items.find((s) => nameOf(s).toLowerCase() === needle) ??
    items.find((s) => s.icon?.key === needle) ??
    items.find((s) => nameOf(s).toLowerCase().includes(needle));
  if (!found) {
    throw new Error(
      `No service called "${name}". This architecture has: ${items.map(nameOf).join(', ')}.`,
    );
  }
  return found;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'read_architecture': {
      const { model, format } = await readModel(String(args.path));
      return { format, services: servicesOf(model), links: linksOf(model) };
    }

    case 'analyze_architecture': {
      const { model } = await readModel(String(args.path));
      const analysis = analyzeArchitecture(model);
      return {
        score: analysis.score,
        services: analysis.nodes,
        links: analysis.edges,
        findings: analysis.findings.map((f) => ({
          kind: f.kind,
          severity: f.severity,
          // An agent reads prose, unlike a pipeline, so it gets both: the kind
          // to reason with and the sentence to repeat.
          summary: translate('en', FINDING_HEADLINE[f.kind], f.detail),
          detail: f.detail,
        })),
      };
    }

    case 'analyze_impact': {
      const { model } = await readModel(String(args.path));
      const target = findService(model, String(args.service));

      const out = new Map<string, string[]>();
      const into = new Map<string, string[]>();
      for (const c of model.connectors) {
        out.set(c.sourceId, [...(out.get(c.sourceId) ?? []), c.targetId]);
        into.set(c.targetId, [...(into.get(c.targetId) ?? []), c.sourceId]);
      }

      /** Everything reachable following `edges`, which is the blast radius. */
      const walk = (from: string, edges: Map<string, string[]>): string[] => {
        const seen = new Set<string>();
        const queue = [from];
        while (queue.length) {
          for (const next of edges.get(queue.shift()!) ?? []) {
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
          }
        }
        seen.delete(from);
        return [...seen].map((id) => nameOf(getShape(model, id)!));
      };

      const analysis = analyzeArchitecture(model);
      const spof = analysis.findings.find(
        (f) => f.kind === 'singlePointOfFailure' && f.shapeIds.includes(target.id),
      );

      return {
        service: nameOf(target),
        // Directly attached first: those are the ones somebody has to be told.
        callers: (into.get(target.id) ?? []).map((id) => nameOf(getShape(model, id)!)),
        calls: (out.get(target.id) ?? []).map((id) => nameOf(getShape(model, id)!)),
        reaches: walk(target.id, out),
        reachedBy: walk(target.id, into),
        splitsArchitecture: Boolean(spof),
        splitsInto: spof?.detail.splits,
      };
    }

    case 'search_components': {
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      const result = queryCatalog({ cloud: 'aws', query: String(args.query), limit });
      return {
        total: result.total,
        services: result.sections
          .flatMap((s) => s.services)
          .map((s) => ({ key: s.key, label: s.label, cloud: s.category, area: s.subcategory })),
      };
    }

    case 'diff_architecture': {
      const before = await readModel(String(args.before));
      const after = await readModel(String(args.after));
      const result = diffModels(before.model, after.model);
      return {
        identical: result.identical,
        services: result.nodes.map((n) => ({
          change: n.kind,
          name: nameOf(n.shape),
          fields: n.fields,
        })),
        links: result.edges.map((e) => ({ change: e.kind, from: e.from, to: e.to })),
      };
    }

    case 'write_architecture': {
      const source = String(args.document);
      const parsed = parseDsl(source);
      const errors = parsed.diagnostics.filter((d) => d.severity === 'error');
      // Checked before writing: an agent that has written a broken document
      // would otherwise find out from the next tool call, having already
      // overwritten somebody's file.
      if (!parsed.model || errors.length) {
        throw new Error(
          `The document does not compile: ${errors.map((d) => d.message).join('; ')}`,
        );
      }
      await writeFile(String(args.path), serializeDsl(parsed.model), 'utf8');
      const analysis = analyzeArchitecture(parsed.model);
      return {
        written: String(args.path),
        services: analysis.nodes,
        links: analysis.edges,
        score: analysis.score,
        findings: analysis.findings.map((f) => translate('en', FINDING_HEADLINE[f.kind], f.detail)),
      };
    }

    case 'check_standards': {
      const { model } = await readModel(String(args.path));
      const shared = args.rules ? parseRules(await readFile(String(args.rules), 'utf8')).rules : [];
      const report = checkRules(model, {
        version: 1,
        rules: [...(model.rules ?? []), ...shared],
      });
      return {
        checked: report.checked,
        violations: report.violations.map((v) => ({
          rule: v.ruleId,
          severity: v.severity,
          subject: v.subject,
          field: v.field,
          // Verbatim: the rule is the team's sentence, not this tool's.
          says: v.description,
        })),
        rulesThatMatchedNothing: report.inert,
      };
    }

    case 'to_mermaid': {
      const { model } = await readModel(String(args.path));
      return { mermaid: toMermaid(model) };
    }

    default:
      throw new Error(`No tool called "${name}".`);
  }
}

export async function handle(request: Request): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0' as const, id: request.id, result });

  switch (request.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'ac-graph', version: '0.1.0' },
      });

    // A notification carries no id and takes no answer; replying to one is a
    // protocol error, not a courtesy.
    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return reply({ tools: TOOLS });

    case 'tools/call': {
      const name = String(request.params?.name ?? '');
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args);
        return reply({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (caught) {
        // Reported as a tool result rather than a protocol error: the agent can
        // read it, reason about it and try again, which a JSON-RPC error code
        // does not let it do.
        return reply({
          content: [
            { type: 'text', text: caught instanceof Error ? caught.message : String(caught) },
          ],
          isError: true,
        });
      }
    }

    default:
      return {
        jsonrpc: '2.0' as const,
        id: request.id,
        error: { code: -32601, message: `Unknown method "${request.method}".` },
      };
  }
}

/** Reads newline-delimited JSON-RPC from stdin and answers on stdout. */
export async function serve(input: NodeJS.ReadableStream, output: NodeJS.WritableStream) {
  let buffer = '';
  input.setEncoding('utf8');

  for await (const chunk of input) {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;

      let response: object | null;
      try {
        response = await handle(JSON.parse(line) as Request);
      } catch {
        response = {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error.' },
        };
      }
      if (response) output.write(`${JSON.stringify(response)}\n`);
    }
  }
}
