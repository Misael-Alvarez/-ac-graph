import type { DslDocument, NodeSpec } from '@/lib/dsl';
import { serviceForResource } from '@/data/resourceServices';
import {
  ImportError,
  environmentFrom,
  keyMaker,
  titleFrom,
  type ImportResult,
  type ImportWarning,
} from './shared';

/**
 * Terraform and OpenTofu into an architecture.
 *
 * Two inputs, because people have two things to hand. `terraform show -json` is
 * the truthful one: it is what will actually exist, with modules flattened and
 * references resolved, and it needs no parser beyond `JSON.parse`. But the file
 * somebody has open is `main.tf`, so HCL is read too — not properly, which would
 * mean shipping an HCL grammar, but well enough to find the resources and the
 * references between them, which is all a diagram is made of.
 *
 * The HCL reader is deliberately shallow and says so in its warnings. A diagram
 * that is roughly right and honest about it beats no diagram, and every node it
 * produces is editable the moment it lands.
 */

interface PlanResource {
  address?: string;
  type?: string;
  name?: string;
  mode?: string;
  values?: Record<string, unknown>;
  depends_on?: string[];
}

interface PlanModule {
  resources?: PlanResource[];
  child_modules?: PlanModule[];
  address?: string;
}

interface Plan {
  format_version?: string;
  terraform_version?: string;
  planned_values?: { root_module?: PlanModule };
  values?: { root_module?: PlanModule };
  configuration?: {
    root_module?: {
      resources?: {
        address?: string;
        type?: string;
        name?: string;
        expressions?: Record<string, unknown>;
      }[];
    };
  };
}

interface Resource {
  /** `aws_lambda_function.checkout`, which is how Terraform refers to it. */
  address: string;
  type: string;
  name: string;
  /** The module it came from, which becomes a boundary. */
  module?: string;
  /** Addresses this one refers to, the source of every arrow. */
  references: string[];
}

/** Walks the module tree flat, remembering which module each resource came from. */
function collectResources(module: PlanModule | undefined, moduleName?: string): Resource[] {
  if (!module) return [];

  const here = (module.resources ?? [])
    // `data` blocks read the world rather than build it; drawing them as boxes
    // would fill the diagram with things nobody deployed.
    .filter((r) => r.mode !== 'data' && r.type && r.name)
    .map((r) => ({
      address: r.address ?? `${r.type}.${r.name}`,
      type: r.type!,
      name: r.name!,
      module: moduleName,
      references: r.depends_on ?? [],
    }));

  const children = (module.child_modules ?? []).flatMap((child) =>
    collectResources(child, child.address?.replace(/^module\./, '') ?? moduleName),
  );
  return [...here, ...children];
}

/** Every `aws_x.y` address mentioned anywhere inside a configuration expression. */
function referencesIn(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\.([A-Za-z0-9_-]+)/g)) {
      into.add(`${match[1]}.${match[2]}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) referencesIn(item, into);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) referencesIn(item, into);
  }
}

function fromPlan(plan: Plan): { resources: Resource[]; warnings: ImportWarning[] } {
  const root = plan.planned_values?.root_module ?? plan.values?.root_module;
  const resources = collectResources(root);
  const warnings: ImportWarning[] = [];

  // The plan's `configuration` block holds the expressions, and an expression
  // mentioning another resource *is* the dependency — `depends_on` alone catches
  // only the ones somebody wrote out by hand.
  const byAddress = new Map(resources.map((r) => [r.address, r]));
  for (const configured of plan.configuration?.root_module?.resources ?? []) {
    const address = configured.address ?? `${configured.type}.${configured.name}`;
    const resource = byAddress.get(address);
    if (!resource) continue;
    const found = new Set<string>(resource.references);
    referencesIn(configured.expressions, found);
    found.delete(address);
    resource.references = [...found];
  }

  if (!resources.length) warnings.push({ kind: 'noResources' });
  return { resources, warnings };
}

/**
 * Finds resources in HCL without parsing it.
 *
 * A `resource "type" "name" {` header is unambiguous even in a file this cannot
 * otherwise read, and a resource's body mentions the others it depends on. That
 * is enough for the shape of the architecture; it is not enough for counts,
 * conditionals or `for_each`, which the warning says.
 */
function fromHcl(source: string): { resources: Resource[]; warnings: ImportWarning[] } {
  const header = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  const found: { type: string; name: string; from: number }[] = [];
  for (const match of source.matchAll(header)) {
    found.push({ type: match[1], name: match[2], from: match.index + match[0].length });
  }

  const resources: Resource[] = found.map((r, i) => {
    // Body runs to the next resource header, which is close enough to a brace
    // matcher for finding references and immune to unbalanced braces in strings.
    const body = source.slice(r.from, i + 1 < found.length ? found[i + 1].from : undefined);
    const references = new Set<string>();
    referencesIn(body, references);
    references.delete(`${r.type}.${r.name}`);
    return {
      address: `${r.type}.${r.name}`,
      type: r.type,
      name: r.name,
      references: [...references],
    };
  });

  const warnings: ImportWarning[] = resources.length ? [{ kind: 'readFromHcl' }] : [];
  return { resources, warnings };
}

/** The cloud a set of resource types is mostly in, for the document's default. */
function dominantCloud(types: string[]): 'aws' | 'azure' | 'gcp' | undefined {
  const counts = { aws: 0, azure: 0, gcp: 0 };
  for (const type of types) {
    if (type.startsWith('aws_')) counts.aws += 1;
    else if (type.startsWith('azurerm_') || type.startsWith('azuread_')) counts.azure += 1;
    else if (type.startsWith('google_')) counts.gcp += 1;
  }
  const best = (Object.entries(counts) as ['aws' | 'azure' | 'gcp', number][]).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return best[1] > 0 ? best[0] : undefined;
}

export function fromTerraform(source: string): ImportResult {
  const text = source.trim();
  if (!text) throw new ImportError('Nothing to import.', 'empty');

  let read: { resources: Resource[]; warnings: ImportWarning[] };
  if (text.startsWith('{')) {
    let plan: Plan;
    try {
      plan = JSON.parse(text) as Plan;
    } catch {
      throw new ImportError('That is not readable JSON.', 'unreadable');
    }
    read = fromPlan(plan);
  } else {
    read = fromHcl(text);
  }

  if (!read.resources.length) {
    throw new ImportError('No Terraform resources found.', 'unrecognised');
  }

  const warnings = [...read.warnings];
  const key = keyMaker();
  const keyByAddress = new Map<string, string>();
  const nodes: Record<string, NodeSpec> = {};
  const modules = new Map<string, string>();
  const unmapped = new Set<string>();

  for (const resource of read.resources) {
    const service = serviceForResource(resource.type);
    if (!service) unmapped.add(resource.type);

    const nodeKey = key(resource.name);
    keyByAddress.set(resource.address, nodeKey);

    const spec: NodeSpec = {
      service: service ?? 'gen-server',
      label: titleFrom(resource.name),
      // The address is what somebody greps for when they go looking in the code.
      technology: resource.type,
    };

    const environment = environmentFrom(resource.name) ?? environmentFrom(resource.module ?? '');
    if (environment) spec.environment = environment;

    if (resource.module) {
      const existing = modules.get(resource.module);
      const boundaryKey = existing ?? key(resource.module);
      modules.set(resource.module, boundaryKey);
      spec.in = boundaryKey;
    }

    nodes[nodeKey] = spec;
  }

  const edges: { from: string; to: string; label: string; style: 'solid' }[] = [];
  for (const resource of read.resources) {
    const from = keyByAddress.get(resource.address);
    if (!from) continue;
    for (const reference of resource.references) {
      const to = keyByAddress.get(reference);
      // A reference runs from the dependent to what it depends on, which is the
      // direction the data and the deploy both go.
      if (to && to !== from) edges.push({ from, to, label: '', style: 'solid' });
    }
  }

  if (unmapped.size) {
    warnings.push({
      kind: 'unknownResourceTypes',
      values: { types: [...unmapped].sort().join(', ') },
    });
  }

  const document: DslDocument = {
    version: 1,
    nodes,
    edges,
  };

  const cloud = dominantCloud(read.resources.map((r) => r.type));
  if (cloud) document.cloud = cloud;
  if (modules.size) {
    document.boundaries = Object.fromEntries(
      [...modules].map(([name, boundaryKey]) => [
        boundaryKey,
        { label: titleFrom(name), variant: 'outer' as const },
      ]),
    );
  }

  return { format: 'terraform', document, warnings };
}
