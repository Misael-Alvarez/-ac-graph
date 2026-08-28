import { z } from 'zod';

/**
 * Architecture standards, written down so they can be checked.
 *
 * The study's phrasing is "architecture standards become executable". A team
 * already has these rules — production services name an owner, nothing talks to
 * the ledger but payments, customer data never travels unauthenticated — and
 * they live in a wiki page nobody reads and a reviewer's memory. Here they are
 * data: they travel with the architecture, they round-trip through the DSL, and
 * `ac-graph check` fails a build on them.
 *
 * Deliberately declarative, not code. A rule that could run arbitrary
 * expressions would be a rule nobody could safely share, store in a diagram or
 * send through a link — and the vocabulary below is the whole of what the model
 * knows about itself anyway.
 *
 * Every object here is `.strict()`, and that is the most important decision in
 * the file. A rule with a misspelled field is a rule that matches nothing and
 * passes silently, which looks exactly like a rule that is working; refusing to
 * read it is the only way anybody finds out.
 *
 * Nothing here imports the domain, deliberately. `DiagramModel` carries the
 * rules an architecture declares, so a rule schema that reached back for the
 * domain's enums would close a cycle — and both halves are Zod schemas built at
 * module load, where a cycle is not a warning but a crash. A matcher is a
 * string; it does not need the enum to say so.
 */

/** Matches a value, a list of allowed values, or merely "is set at all". */
const MatcherSchema = z.union([z.string(), z.array(z.string()), z.boolean()]);
const matcher = MatcherSchema.optional();

/** What the model knows about a service, and so what a rule may ask about one. */
const NODE_FIELDS = {
  /** Catalogue key, whole (`aws-rds`) or by cloud (`aws-`). */
  service: matcher,
  technology: matcher,
  owner: matcher,
  repository: matcher,
  environment: matcher,
  criticality: matcher,
  lifecycle: matcher,
  /** True when the service carries this tag; a list means any of them. */
  tag: matcher,
};

/** What the model knows about a link. */
const EDGE_FIELDS = {
  protocol: matcher,
  kind: matcher,
  auth: matcher,
  dataClass: matcher,
};

/**
 * Which services a rule is about.
 *
 * Absent fields do not narrow. An empty selector is every service, which is what
 * a rule like "everything needs an owner" means.
 */
export const NodeSelectorSchema = z.object(NODE_FIELDS).strict();

export const EdgeSelectorSchema = z
  .object({
    ...EDGE_FIELDS,
    /** The service the link starts at, and the one it ends at. */
    from: NodeSelectorSchema.optional(),
    to: NodeSelectorSchema.optional(),
  })
  .strict();

/**
 * What a rule demands, or exempts.
 *
 * One schema covering both vocabularies rather than a union of two. A union
 * would take whichever branch parsed first and quietly drop everything the
 * other one knew — `require: {auth: true}` became `{}`, and the rule passed on
 * every architecture there has ever been. The refinement below is what keeps a
 * service rule from asking about a protocol.
 */
const ClauseSchema = z
  .object({
    ...NODE_FIELDS,
    ...EDGE_FIELDS,
    from: z.unknown().optional(),
    to: z.unknown().optional(),
  })
  .strict();

const NODE_NAMES = new Set(Object.keys(NODE_FIELDS));
const EDGE_NAMES = new Set([...Object.keys(EDGE_FIELDS), 'from', 'to']);

const SeveritySchema = z.enum(['high', 'medium', 'low']);

/**
 * One standard.
 *
 * A rule either **requires** something of what it matches, or **forbids** the
 * match existing at all. Those are the two shapes every example in the study
 * reduces to: "production services require an owner" and "services cannot reach
 * production databases directly".
 */
export const RuleSchema = z
  .object({
    id: z.string(),
    /** The team's own sentence, in the team's own language. Shown verbatim. */
    description: z.string(),
    severity: SeveritySchema.default('high'),

    /* Exactly one of `services` / `links` says what the rule is about, and
       exactly one of `require` / `forbid` says what it demands. Either mixed or
       either missing would pass on every architecture. */
    services: NodeSelectorSchema.optional(),
    links: EdgeSelectorSchema.optional(),
    require: ClauseSchema.optional(),
    forbid: z.boolean().optional(),

    /** Matches exempted from the rule: the "except payments" half of a rule. */
    except: ClauseSchema.optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (Boolean(rule.services) === Boolean(rule.links)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A rule is about `services` or about `links`, and must say which.',
      });
    }
    if (Boolean(rule.require) === Boolean(rule.forbid)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A rule either `require`s something of what it matches, or `forbid`s the match.',
      });
    }

    // A service rule asking about a protocol, or a link rule asking about an
    // owner, is a rule its author has misunderstood — and one that would never
    // fire.
    const allowed = rule.services ? NODE_NAMES : EDGE_NAMES;
    for (const clause of ['require', 'except'] as const) {
      for (const field of Object.keys(rule[clause] ?? {})) {
        if (allowed.has(field)) continue;
        ctx.addIssue({
          code: 'custom',
          path: [clause, field],
          message: `\`${field}\` is not something a rule about ${
            rule.services ? 'services' : 'links'
          } can ask about.`,
        });
      }
    }
  });

export const RuleDocumentSchema = z.object({
  version: z.number().default(1),
  rules: z.array(RuleSchema).default([]),
});

export type Matcher = z.infer<typeof MatcherSchema>;
export type NodeSelector = z.infer<typeof NodeSelectorSchema>;
export type EdgeSelector = z.infer<typeof EdgeSelectorSchema>;
export type Clause = z.infer<typeof ClauseSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type RuleDocument = z.infer<typeof RuleDocumentSchema>;
export type RuleSeverity = z.infer<typeof SeveritySchema>;
