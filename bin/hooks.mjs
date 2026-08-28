import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Resolving the app's own import style outside a bundler.
 *
 * The source is written the way Next resolves it — `@/lib/dsl` for a root import
 * and `./model` with no extension for a neighbour. Node does neither. Rather
 * than keep a second, differently-written copy of the library for the CLI, or
 * add a build step and a bundler to ship one binary, this teaches Node the two
 * rules. It is the whole cost of running the real code from a terminal.
 */
const SRC = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'src') + '/').href;

/** The first of `x`, `x.ts`, `x.tsx`, `x/index.ts`, `x/index.tsx` that exists. */
function firstExisting(base) {
  const withoutSlash = base.endsWith('/') ? base.slice(0, -1) : base;
  for (const candidate of [
    withoutSlash,
    `${withoutSlash}.ts`,
    `${withoutSlash}.tsx`,
    `${withoutSlash}/index.ts`,
    `${withoutSlash}/index.tsx`,
  ]) {
    if (!candidate.endsWith('.ts') && !candidate.endsWith('.tsx')) continue;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

export function resolve(specifier, context, next) {
  let target = null;
  if (specifier.startsWith('@/')) {
    target = firstExisting(SRC + specifier.slice(2));
  } else if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
    target = firstExisting(new URL(specifier, context.parentURL).href);
  }
  // `module-typescript` rather than `module`: without it Node loads the file as
  // plain JavaScript and chokes on the first type annotation.
  if (target) return { url: target, format: 'module-typescript', shortCircuit: true };
  return next(specifier, context);
}
