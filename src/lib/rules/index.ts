import { parse as parseYaml } from 'yaml';
import { RuleDocumentSchema, type RuleDocument } from './schema';

export * from './schema';
export * from './evaluate';

/** Reads a rules document from YAML or JSON, failing loudly on a bad rule. */
export function parseRules(source: string): RuleDocument {
  const parsed = RuleDocumentSchema.safeParse(parseYaml(source));
  if (parsed.success) return parsed.data;

  // Named by rule and by field: "invalid input" over a file of twenty standards
  // is not something anybody can act on.
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'document'}: ${issue.message}`)
    .join('\n  ');
  throw new Error(`These rules cannot be read:\n  ${issues}`);
}

/** An empty document, for the common case of an architecture declaring none. */
export const NO_RULES: RuleDocument = { version: 1, rules: [] };
