import { describe, expect, it } from 'vitest';
import { compile, parseDsl } from '@/lib/dsl';
import type { DiagramModel } from '@/lib/domain';
import { checkRules, parseRules } from './index';

/**
 * The architecture the study's own example rules are written against: a public
 * API, two services, a production database holding customer data, and one link
 * that goes straight past the service that owns it.
 */
const ARCHITECTURE = `version: 1
cloud: aws
nodes:
  gateway:
    service: apigateway
    label: Public API
    owner: platform
    environment: prod
  payments:
    service: lambda
    label: Payments
    owner: payments
    environment: prod
    tags: [pci]
  reporting:
    service: lambda
    label: Reporting
    environment: prod
  ledger:
    service: rds
    label: Ledger
    owner: payments
    environment: prod
    criticality: critical
    tags: [database, pci]
edges:
  - {from: gateway, to: payments, label: HTTPS, protocol: https, auth: OAuth2}
  - {from: payments, to: ledger, label: SQL, protocol: sql, auth: mTLS, dataClass: pci}
  - {from: reporting, to: ledger, label: SQL, protocol: sql, dataClass: pci}
`;

const model = (): DiagramModel => parseDsl(ARCHITECTURE).model!;

const check = (source: string) => checkRules(model(), parseRules(source));
const ids = (report: ReturnType<typeof check>) => report.violations.map((v) => v.ruleId);
const subjects = (report: ReturnType<typeof check>) => report.violations.map((v) => v.subject);

describe('requiring something of a service', () => {
  it('catches a production service with no owner', () => {
    const report = check(`
rules:
  - id: prod-needs-owner
    description: Every production service names the team that answers for it.
    services: {environment: prod}
    require: {owner: true}
`);
    expect(subjects(report)).toEqual(['Reporting']);
  });

  it('says which requirement failed, not merely that one did', () => {
    // "Requires an owner and a repository" is one rule and two different pieces
    // of work; a violation that does not say which is a violation nobody can act on.
    const report = check(`
rules:
  - id: prod-needs-owner
    description: Production services name an owner and a repository.
    services: {environment: prod}
    require: {owner: true, repository: true}
`);
    expect(report.violations.map((v) => `${v.subject}:${v.field}`)).toEqual([
      'Public API:repository',
      'Payments:repository',
      'Reporting:owner',
      'Ledger:repository',
    ]);
  });

  it('accepts a value as well as mere presence', () => {
    const report = check(`
rules:
  - id: only-known-teams
    description: A service belongs to one of the teams we have.
    services: {environment: prod}
    require: {owner: [platform, payments]}
`);
    expect(subjects(report)).toEqual(['Reporting']);
  });

  it('selects a whole cloud with a trailing dash', () => {
    const report = check(`
rules:
  - id: aws-needs-owner
    description: Anything on AWS names an owner.
    services: {service: 'aws-'}
    require: {owner: true}
`);
    expect(subjects(report)).toEqual(['Reporting']);
  });

  it('matches on tags', () => {
    const report = check(`
rules:
  - id: pci-needs-criticality
    description: Anything in PCI scope states how critical it is.
    services: {tag: pci}
    require: {criticality: true}
`);
    expect(subjects(report)).toEqual(['Payments']);
  });

  it('passes when everything it matches satisfies it', () => {
    const report = check(`
rules:
  - id: databases-are-owned
    description: Databases name an owner.
    services: {tag: database}
    require: {owner: true}
`);
    expect(report.violations).toEqual([]);
  });
});

describe('forbidding a link, which is the other half of every standard', () => {
  it('catches a service reaching a production database it does not own', () => {
    // The study's example, almost word for word: "services cannot access
    // production databases directly".
    const report = check(`
rules:
  - id: ledger-is-private
    description: Only the payments service talks to the ledger.
    links: {to: {tag: database}}
    forbid: true
    except: {from: {owner: payments}}
`);
    expect(subjects(report)).toEqual(['Reporting → Ledger']);
  });

  it('exempts what the exception names, rather than reporting it and hoping', () => {
    const report = check(`
rules:
  - id: ledger-is-private
    description: Only the payments service talks to the ledger.
    links: {to: {tag: database}}
    forbid: true
    except: {from: {owner: payments}}
`);
    expect(subjects(report)).not.toContain('Payments → Ledger');
  });

  it('requires customer data to travel authenticated', () => {
    const report = check(`
rules:
  - id: pci-authenticated
    description: Card data never travels unauthenticated.
    links: {dataClass: [pci, pii]}
    require: {auth: true}
`);
    expect(subjects(report)).toEqual(['Reporting → Ledger']);
  });

  it('forbids a service existing at all when a rule says so', () => {
    const report = check(`
rules:
  - id: no-more-lambda
    description: We are moving off Lambda; no new ones.
    services: {service: aws-lambda}
    forbid: true
`);
    expect(subjects(report)).toEqual(['Payments', 'Reporting']);
  });
});

describe('a rule that is not doing anything', () => {
  it('reports one that matches nothing, since it passes for the wrong reason', () => {
    // A selector with a typo in it is the most common way a standard silently
    // stops being enforced, and it looks exactly like a rule that is working.
    const report = check(`
rules:
  - id: typo
    description: Every service in producton names an owner.
    services: {environment: producton}
    require: {owner: true}
`);
    expect(report.violations).toEqual([]);
    expect(report.inert).toEqual(['typo']);
  });

  it('does not report one that matches and passes', () => {
    const report = check(`
rules:
  - id: real
    description: Databases name an owner.
    services: {tag: database}
    require: {owner: true}
`);
    expect(report.inert).toEqual([]);
  });
});

describe('reporting', () => {
  it('puts the worst first', () => {
    const report = check(`
rules:
  - id: b-low
    description: Low.
    severity: low
    services: {environment: prod}
    require: {repository: true}
  - id: a-high
    description: High.
    severity: high
    services: {environment: prod}
    require: {owner: true}
`);
    expect(report.violations[0].severity).toBe('high');
    expect(ids(report).at(-1)).toBe('b-low');
  });

  it("carries the team's own sentence, untranslated", () => {
    // This is the one place prose belongs to the data: nobody can translate a
    // rule only its author has read.
    const report = check(`
rules:
  - id: propiedad
    description: Todo servicio en producción declara un equipo responsable.
    services: {environment: prod}
    require: {owner: true}
`);
    expect(report.violations[0].description).toBe(
      'Todo servicio en producción declara un equipo responsable.',
    );
  });

  it('points at the shapes and links involved, so an interface can select them', () => {
    const report = check(`
rules:
  - id: pci-authenticated
    description: Card data never travels unauthenticated.
    links: {dataClass: pci}
    require: {auth: true}
`);
    expect(report.violations[0].shapeIds).toHaveLength(2);
    expect(report.violations[0].connectorIds).toHaveLength(1);
  });

  it('counts what it checked', () => {
    const report = check(`
rules:
  - id: one
    description: One.
    services: {}
    require: {owner: true}
  - id: two
    description: Two.
    services: {}
    require: {environment: true}
`);
    expect(report.checked).toBe(2);
  });
});

describe('reading a rules document', () => {
  it('takes an empty one', () => {
    expect(parseRules('version: 1').rules).toEqual([]);
  });

  it('defaults a severity, since most rules are simply "do not do this"', () => {
    const document = parseRules(`
rules:
  - id: x
    description: X.
    services: {}
    require: {owner: true}
`);
    expect(document.rules[0].severity).toBe('high');
  });

  it('refuses a rule that is about neither services nor links', () => {
    expect(() =>
      parseRules('rules:\n  - {id: x, description: X., require: {owner: true}}'),
    ).toThrow(/services[\s\S]*links/);
  });

  it('refuses a rule that both requires and forbids', () => {
    expect(() =>
      parseRules(
        'rules:\n  - {id: x, description: X., services: {}, require: {owner: true}, forbid: true}',
      ),
    ).toThrow(/require/);
  });

  it('refuses a rule that demands nothing, which would pass on everything', () => {
    expect(() => parseRules('rules:\n  - {id: x, description: X., services: {}}')).toThrow();
  });

  it('names the rule and the field when it cannot read one', () => {
    expect(() => parseRules('rules:\n  - {description: no id here}')).toThrow(/rules\.0/);
  });
});

describe('an architecture that declares no rules', () => {
  it('is checked against nothing and passes', () => {
    const report = checkRules(model(), { version: 1, rules: [] });
    expect(report).toEqual({ violations: [], inert: [], checked: 0 });
  });
});

describe('rules survive the trip through the compiler', () => {
  it('checks a model compiled from a document, not only a parsed one', () => {
    const { document } = parseDsl(ARCHITECTURE);
    const compiled = compile(document!).model;
    const report = checkRules(
      compiled,
      parseRules(
        'rules:\n  - {id: r, description: R., services: {environment: prod}, require: {owner: true}}',
      ),
    );
    expect(subjects(report)).toEqual(['Reporting']);
  });
});

describe('a rule this cannot read is refused, never quietly narrowed', () => {
  // The bug this exists to prevent: `require` and `except` were a union of the
  // node and link vocabularies, so Zod took whichever branch parsed first and
  // dropped everything the other knew. `require: {auth: true}` became `{}` and
  // the rule passed on every architecture there has ever been.
  it('refuses a link rule asking about an owner', () => {
    expect(() =>
      parseRules('rules:\n  - {id: x, description: X., links: {}, require: {owner: true}}'),
    ).toThrow(/owner/);
  });

  it('refuses a service rule asking about a protocol', () => {
    expect(() =>
      parseRules('rules:\n  - {id: x, description: X., services: {}, require: {protocol: https}}'),
    ).toThrow(/protocol/);
  });

  it('keeps a link rule that asks about a link', () => {
    const report = check(`
rules:
  - id: sql-authenticated
    description: SQL never travels unauthenticated.
    links: {protocol: sql}
    require: {auth: true}
`);
    expect(subjects(report)).toEqual(['Reporting → Ledger']);
  });

  it('refuses a field that is not in either vocabulary', () => {
    expect(() =>
      parseRules('rules:\n  - {id: x, description: X., services: {colour: blue}, forbid: true}'),
    ).toThrow(/colour/);
  });

  it('refuses a misspelled top-level key', () => {
    expect(() =>
      parseRules('rules:\n  - {id: x, descriptoin: X., services: {}, forbid: true}'),
    ).toThrow();
  });
});
