import type { Connector, DiagramModel, Shape } from '@/lib/domain';
import type {
  EdgeSelector,
  Matcher,
  NodeSelector,
  Rule,
  RuleDocument,
  RuleSeverity,
} from './schema';

/**
 * Checking an architecture against the standards it declares.
 *
 * Everything here is a pure function of the model and the rules, like the rest
 * of the engine, so the same answer reaches the insights panel, the CLI's exit
 * code and an agent asking over MCP.
 *
 * A violation carries the rule's own `description` rather than a generated
 * sentence. That copy is the team's, written in the team's language, and this
 * is the one place in the app where prose belongs to the data instead of to the
 * interface: nobody can translate a rule nobody but its author has read.
 */

export interface Violation {
  ruleId: string;
  /** The team's sentence, verbatim. */
  description: string;
  severity: RuleSeverity;
  /** What broke it, named the way the diagram names it. */
  subject: string;
  shapeIds: string[];
  connectorIds: string[];
  /** Which requirement failed, for a rule that requires several things. */
  field?: string;
}

export interface RuleReport {
  violations: Violation[];
  /** Rules that matched nothing, which usually means a typo in a selector. */
  inert: string[];
  checked: number;
}

const nameOf = (shape: Shape): string => shape.title || shape.icon?.key || shape.id;

/**
 * Whether a value satisfies a matcher.
 *
 * `true` means "is set at all", `false` means "is not set", a string matches
 * exactly or as a prefix when it ends in `-` (so `aws-` selects a whole cloud),
 * and a list matches any of its entries.
 */
function matches(value: string | undefined, matcher: Matcher): boolean {
  if (typeof matcher === 'boolean') return matcher ? Boolean(value) : !value;
  if (!value) return false;
  const wanted = Array.isArray(matcher) ? matcher : [matcher];
  return wanted.some((w) => (w.endsWith('-') ? value.startsWith(w) : value === w));
}

/** Whether any of a service's tags satisfies the matcher. */
function tagMatches(tags: string[] | undefined, matcher: Matcher): boolean {
  if (typeof matcher === 'boolean') return matcher ? Boolean(tags?.length) : !tags?.length;
  const wanted = Array.isArray(matcher) ? matcher : [matcher];
  return wanted.some((w) => tags?.includes(w) ?? false);
}

/** The fields of a node selector, and where each reads its value from. */
function nodeField(shape: Shape, field: keyof NodeSelector): string | undefined {
  if (field === 'service') return shape.icon?.key;
  if (field === 'tag') return undefined;
  return shape.meta?.[field];
}

export function nodeMatches(shape: Shape, selector: NodeSelector): boolean {
  return Object.entries(selector).every(([field, matcher]) => {
    if (matcher === undefined) return true;
    if (field === 'tag') return tagMatches(shape.meta?.tags, matcher as Matcher);
    return matches(nodeField(shape, field as keyof NodeSelector), matcher as Matcher);
  });
}

function edgeMatches(
  connector: Connector,
  selector: EdgeSelector,
  byId: Map<string, Shape>,
): boolean {
  return Object.entries(selector).every(([field, matcher]) => {
    if (matcher === undefined) return true;
    if (field === 'from' || field === 'to') {
      const shape = byId.get(field === 'from' ? connector.sourceId : connector.targetId);
      return shape ? nodeMatches(shape, matcher as NodeSelector) : false;
    }
    return matches(
      connector.meta?.[field as 'protocol' | 'kind' | 'auth' | 'dataClass'],
      matcher as Matcher,
    );
  });
}

/**
 * The first requirement a subject fails, or nothing when it satisfies them all.
 *
 * Returns the field rather than a boolean so a violation can say *which* part
 * of a rule broke: "requires an owner and a repository" is one rule and two
 * quite different pieces of work.
 */
function firstUnmet(
  requirement: Record<string, Matcher | undefined>,
  read: (field: string) => string | undefined,
  tags?: string[],
): string | undefined {
  for (const [field, matcher] of Object.entries(requirement)) {
    if (matcher === undefined) continue;
    const ok = field === 'tag' ? tagMatches(tags, matcher) : matches(read(field), matcher);
    if (!ok) return field;
  }
  return undefined;
}

function checkRule(rule: Rule, model: DiagramModel, byId: Map<string, Shape>): Violation[] {
  const violations: Violation[] = [];
  const base = {
    ruleId: rule.id,
    description: rule.description,
    severity: rule.severity,
  };

  if (rule.services) {
    const exempt = (rule.except ?? {}) as NodeSelector;
    const subjects = model.shapes.filter(
      (s) =>
        s.type === 'item' &&
        nodeMatches(s, rule.services!) &&
        !(rule.except && nodeMatches(s, exempt)),
    );

    for (const shape of subjects) {
      if (rule.forbid) {
        violations.push({
          ...base,
          subject: nameOf(shape),
          shapeIds: [shape.id],
          connectorIds: [],
        });
        continue;
      }
      const field = firstUnmet(
        rule.require as Record<string, Matcher | undefined>,
        (f) => nodeField(shape, f as keyof NodeSelector),
        shape.meta?.tags,
      );
      if (field) {
        violations.push({
          ...base,
          subject: nameOf(shape),
          shapeIds: [shape.id],
          connectorIds: [],
          field,
        });
      }
    }
    return violations;
  }

  const exempt = (rule.except ?? {}) as EdgeSelector;
  const subjects = model.connectors.filter(
    (c) => edgeMatches(c, rule.links!, byId) && !(rule.except && edgeMatches(c, exempt, byId)),
  );

  for (const connector of subjects) {
    const from = byId.get(connector.sourceId);
    const to = byId.get(connector.targetId);
    const subject = `${from ? nameOf(from) : connector.sourceId} → ${
      to ? nameOf(to) : connector.targetId
    }`;
    const shapeIds = [connector.sourceId, connector.targetId];

    if (rule.forbid) {
      violations.push({ ...base, subject, shapeIds, connectorIds: [connector.id] });
      continue;
    }
    const field = firstUnmet(
      rule.require as Record<string, Matcher | undefined>,
      (f) => connector.meta?.[f as 'protocol' | 'kind' | 'auth' | 'dataClass'],
    );
    if (field) {
      violations.push({ ...base, subject, shapeIds, connectorIds: [connector.id], field });
    }
  }
  return violations;
}

/**
 * Checks an architecture against a set of rules.
 *
 * Rules that match nothing come back separately. A rule that matches nothing
 * passes trivially, which is indistinguishable from a rule that is working — and
 * a selector with a typo in it is the most common way a standard silently stops
 * being enforced.
 */
export function checkRules(model: DiagramModel, document: RuleDocument): RuleReport {
  const byId = new Map(model.shapes.map((s) => [s.id, s]));
  const violations: Violation[] = [];
  const inert: string[] = [];

  for (const rule of document.rules) {
    const found = checkRule(rule, model, byId);
    violations.push(...found);

    const matched = rule.services
      ? model.shapes.some((s) => s.type === 'item' && nodeMatches(s, rule.services!))
      : model.connectors.some((c) => edgeMatches(c, rule.links!, byId));
    if (!matched) inert.push(rule.id);
  }

  const order: Record<RuleSeverity, number> = { high: 0, medium: 1, low: 2 };
  violations.sort(
    (a, b) => order[a.severity] - order[b.severity] || a.ruleId.localeCompare(b.ruleId),
  );

  return { violations, inert, checked: document.rules.length };
}
