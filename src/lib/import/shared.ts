import type { DslDocument } from '@/lib/dsl';

/**
 * Many inputs, one architecture.
 *
 * Every importer produces a `DslDocument`, never a `DiagramModel`. The compiler
 * already turns a document into a laid-out, boundaried, metadata-carrying
 * diagram, and it is the one piece that has to stay correct — so an importer's
 * whole job is to answer "what services are there and what talks to what", and
 * nothing here knows about geometry.
 *
 * It also means every import is editable as code the moment it lands, and
 * round-trips through the same serialiser as everything else.
 */

export type ImportFormat = 'terraform' | 'kubernetes' | 'openapi';

/**
 * Something the importer had to guess at or could not use.
 *
 * A kind and its values, never a sentence — the same rule `engine/analysis.ts`
 * follows, and for the same reason: the app is bilingual and the prose belongs
 * to the interface. An importer that returned English could only ever be read
 * in English.
 *
 * Never an error. A real `main.tf` names resource types no catalogue knows, and
 * refusing the file over one of them would be useless; the diagram comes out
 * complete and the reader is told where the tool was unsure.
 */
export interface ImportWarning {
  kind:
    | 'noResources'
    | 'readFromHcl'
    | 'unknownResourceTypes'
    | 'unnamed'
    | 'unknownKind'
    | 'serviceSelectsNothing'
    | 'ingressMissingService'
    | 'noOperations';
  values?: Record<string, string | number>;
}

export interface ImportResult {
  format: ImportFormat;
  document: DslDocument;
  warnings: ImportWarning[];
}

export class ImportError extends Error {
  /** A message key, so the interface says this in the reader's language. */
  readonly code: 'unreadable' | 'empty' | 'unrecognised';

  /* Assigned in the body rather than declared as a constructor parameter: a
     parameter property is TypeScript-only sugar that Node's type stripping
     refuses, and the CLI runs this very file under it. */
  constructor(message: string, code: 'unreadable' | 'empty' | 'unrecognised') {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

/**
 * Turns a name into a document key, unique within one import.
 *
 * The same slug rule the serialiser uses, so a document produced here reads like
 * one somebody wrote by hand and survives the round trip unchanged.
 */
export function keyMaker() {
  const taken = new Set<string>();
  return (name: string): string => {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'node';
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    taken.add(`${base}-${n}`);
    return `${base}-${n}`;
  };
}

/** The environment a name implies, when it plainly implies one. */
export function environmentFrom(name: string): 'dev' | 'qa' | 'staging' | 'prod' | undefined {
  const n = name.toLowerCase();
  if (/\b(prod|production|prd)\b/.test(n) || n === 'prod') return 'prod';
  if (/\b(stag|staging|stg|pre)\b/.test(n)) return 'staging';
  if (/\b(qa|test|uat)\b/.test(n)) return 'qa';
  if (/\b(dev|develop|development)\b/.test(n)) return 'dev';
  return undefined;
}

/** A human-facing name from an identifier: `payments-api` → `Payments api`. */
export function titleFrom(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}
