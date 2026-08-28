import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { DiagramModel } from '@/lib/domain';
import { compile, parseDsl, serializeDsl, toMermaid } from '@/lib/dsl';
import {
  FINDING_HEADLINE,
  SEVERITY_ORDER,
  analyzeArchitecture,
  diffModels,
  type Severity,
} from '@/lib/engine';
import { detectFormat, importArchitecture } from '@/lib/import';
import { LOCALES, translate, type Locale, type MessageKey } from '@/lib/i18n/messages';

/**
 * The architecture, from a terminal.
 *
 * The study's complaint about diagrams is that they rot: drawn for a meeting,
 * screenshotted into a wiki, never true again. A diagram that a pipeline can
 * read is a diagram that can fail a build, and `check` is the whole point of
 * this — everything else here is a convenience beside it.
 *
 * It runs the same library the editor does, not a reimplementation of it. So a
 * check that passes in CI passes in the app, and any check added to the engine
 * is in the pipeline the same day.
 */

const USAGE = `ac-graph — architecture from the terminal

  ac-graph check <file>         Analyse and report; exits non-zero on findings
  ac-graph import <file>        Terraform, Kubernetes or OpenAPI to DSL
  ac-graph mermaid <file>       Draw it, as a Mermaid flowchart
  ac-graph diff <a> <b>         What changed between two architectures
  ac-graph fmt <file>           Rewrite a DSL document in canonical form

Options
  -o, --out <file>              Write here instead of standard output
      --json                    Machine-readable output, for a pipeline
      --fail-on <severity>      high | medium | low   (check, default: high)
      --exit-zero               Report, but do not fail the build
      --lang <locale>           ${LOCALES.join(' | ')}
  -h, --help                    This

Anything not a DSL document is detected and read as infrastructure, so
\`check main.tf\` and \`check k8s/deployment.yaml\` work without saying which is which.

There is no \`render\` here on purpose. The SVG is drawn by the same React
components the canvas uses, which is what keeps an export identical to what the
editor shows; a second renderer written for the terminal would drift from it.
Mermaid is the format Git hosts draw themselves anyway.`;

interface Options {
  out?: string;
  json: boolean;
  failOn: Severity;
  exitZero: boolean;
  locale: Locale;
  rest: string[];
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    json: false,
    failOn: 'high',
    exitZero: false,
    locale: 'en',
    rest: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => argv[(i += 1)];
    if (arg === '-o' || arg === '--out') options.out = take();
    else if (arg === '--json') options.json = true;
    else if (arg === '--exit-zero') options.exitZero = true;
    else if (arg === '--fail-on') {
      const value = take();
      if (!SEVERITY_ORDER.includes(value as Severity)) {
        throw new Error(`--fail-on takes ${SEVERITY_ORDER.join(', ')}, not "${value}".`);
      }
      options.failOn = value as Severity;
    } else if (arg === '--lang') {
      const value = take();
      if (!LOCALES.includes(value as Locale)) {
        throw new Error(`--lang takes ${LOCALES.join(' or ')}, not "${value}".`);
      }
      options.locale = value as Locale;
    } else options.rest.push(arg);
  }
  return options;
}

/**
 * Reads a file into a model, whatever it happens to be.
 *
 * The point of the importers is that a pipeline should not have to say what it
 * is holding; a repository has `main.tf` and `deployment.yaml` in it, and the
 * check should run over both without a flag per format.
 */
async function readModel(
  path: string,
  locale: Locale,
): Promise<{ model: DiagramModel; source: string; format: string }> {
  const source = await readFile(path, 'utf8');
  const infrastructure = detectFormat(source);

  if (infrastructure) {
    const imported = importArchitecture(source, infrastructure, locale);
    const { model } = compile(imported.document, locale);
    return { model, source, format: infrastructure };
  }

  const parsed = parseDsl(source, locale);
  const fatal = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (!parsed.model || fatal.length) {
    throw new Error(
      `${path} is not a readable architecture.\n` + fatal.map((d) => `  ${d.message}`).join('\n'),
    );
  }
  return { model: parsed.model, source, format: 'dsl' };
}

async function emit(text: string, out: string | undefined): Promise<void> {
  if (out) await writeFile(out, text, 'utf8');
  else process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

const DOT: Record<Severity, string> = { high: '✗', medium: '!', low: '·' };

async function check(path: string, options: Options): Promise<number> {
  const t = (key: MessageKey, values?: Record<string, string | number>) =>
    translate(options.locale, key, values);

  const { model, format } = await readModel(path, options.locale);
  const analysis = analyzeArchitecture(model);

  if (options.json) {
    await emit(
      JSON.stringify(
        {
          file: path,
          format,
          score: analysis.score,
          nodes: analysis.nodes,
          edges: analysis.edges,
          // The kind and its values, not the sentence: a pipeline that greps
          // English prose breaks the day somebody runs it with --lang es.
          findings: analysis.findings.map((f) => ({
            id: f.id,
            kind: f.kind,
            severity: f.severity,
            detail: f.detail,
          })),
        },
        null,
        2,
      ),
      options.out,
    );
  } else {
    const lines = [
      `${basename(path)}  ${analysis.score}/100  ` +
        t('insight.counted', { nodes: analysis.nodes, edges: analysis.edges }),
    ];
    if (!analysis.findings.length) lines.push('', `  ${t('insight.clean')}`);
    for (const severity of SEVERITY_ORDER) {
      const group = analysis.findings.filter((f) => f.severity === severity);
      if (!group.length) continue;
      lines.push('', `${t(`insight.${severity}` as MessageKey)}`);
      for (const finding of group) {
        lines.push(`  ${DOT[severity]} ${t(FINDING_HEADLINE[finding.kind], finding.detail)}`);
      }
    }
    await emit(lines.join('\n'), options.out);
  }

  if (options.exitZero) return 0;
  // Everything at or above the chosen severity fails: asking for `--fail-on
  // medium` and being told only about mediums would be a strange promotion of
  // the worse problems into silence.
  const threshold = SEVERITY_ORDER.indexOf(options.failOn);
  const failing = analysis.findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= threshold);
  return failing.length ? 1 : 0;
}

async function runImport(path: string, options: Options): Promise<number> {
  const source = await readFile(path, 'utf8');
  const format = detectFormat(source);
  if (!format) throw new Error(`${path} is not Terraform, Kubernetes or OpenAPI.`);

  const result = importArchitecture(source, format, options.locale);
  const { model } = compile(result.document, options.locale);
  await emit(serializeDsl(model, { title: basename(path, extname(path)) }), options.out);

  // Warnings go to standard error so `ac-graph import x.tf > architecture.yaml`
  // produces a clean file and still tells the person watching what it guessed.
  for (const warning of result.warnings) {
    process.stderr.write(
      `${translate(options.locale, `import.warn.${warning.kind}` as MessageKey, warning.values)}\n`,
    );
  }
  return 0;
}

async function mermaid(path: string, options: Options): Promise<number> {
  const { model } = await readModel(path, options.locale);
  await emit(toMermaid(model), options.out);
  return 0;
}

async function fmt(path: string, options: Options): Promise<number> {
  const { model } = await readModel(path, options.locale);
  const canonical = serializeDsl(model);
  // In place when no `--out`: a formatter that printed to the terminal would be
  // the one command here nobody could use in a pre-commit hook.
  await emit(canonical, options.out ?? path);
  return 0;
}

async function diff(before: string, after: string, options: Options): Promise<number> {
  const a = await readModel(before, options.locale);
  const b = await readModel(after, options.locale);
  const result = diffModels(a.model, b.model);

  if (options.json) {
    await emit(JSON.stringify(result, null, 2), options.out);
  } else {
    const name = (id: string) =>
      [...a.model.shapes, ...b.model.shapes].find((s) => s.id === id)?.title ?? id;
    const lines: string[] = [];
    for (const node of result.nodes) {
      const mark = node.kind === 'added' ? '+' : node.kind === 'removed' ? '-' : '~';
      const fields = node.fields.length ? ` (${node.fields.join(', ')})` : '';
      lines.push(`${mark} ${node.shape.title ?? name(node.shape.id)}${fields}`);
    }
    for (const edge of result.edges) {
      const mark = edge.kind === 'added' ? '+' : edge.kind === 'removed' ? '-' : '~';
      lines.push(`${mark} ${edge.from} → ${edge.to}`);
    }
    await emit(lines.length ? lines.join('\n') : 'No change.', options.out);
  }

  if (options.exitZero) return 0;
  return result.identical ? 0 : 1;
}

export async function main(argv: string[]): Promise<number> {
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(`${USAGE}\n`);
    return argv.length ? 0 : 1;
  }

  try {
    const [command, ...rest] = argv;
    const options = parseOptions(rest);
    const [first, second] = options.rest;

    if (command !== 'diff' && !first) throw new Error(`\`${command}\` needs a file.`);

    switch (command) {
      case 'check':
        return await check(first, options);
      case 'import':
        return await runImport(first, options);
      case 'mermaid':
        return await mermaid(first, options);
      case 'fmt':
        return await fmt(first, options);
      case 'diff':
        if (!first || !second) throw new Error('`diff` needs two files.');
        return await diff(first, second, options);
      default:
        process.stderr.write(`Unknown command "${command}".\n\n${USAGE}\n`);
        return 1;
    }
  } catch (caught) {
    process.stderr.write(`${caught instanceof Error ? caught.message : String(caught)}\n`);
    return 1;
  }
}
