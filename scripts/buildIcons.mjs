import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildCatalog, matchable } from './buildCatalog.mjs';
import { canonicalCategory } from './categories.mjs';
import { renderMark } from './glyphs.mjs';

/**
 * Generates the icon sprite.
 *
 * Three sources, in order of preference:
 *  1. What the app already ships, so nothing regresses.
 *  2. Official AWS architecture icons, which are redistributable.
 *  3. A generated mark in the same visual idiom for everything else, because no
 *     equivalent per-service artwork is redistributable for Azure, GCP, OCI or
 *     IBM. Those marks say the category and the vendor, which is what an icon
 *     can usefully convey at the 24px these render at.
 */
const AWS_ICON_DIR =
  '/private/tmp/claude-501/-Users-misaelalvarezcamarillo-Desktop-diagram-editor/f3711095-a1b8-421d-ac75-207d7c7a658a/scratchpad/node_modules/aws-icons/icons/architecture-service';
const MASTER_LIST = process.argv[2];

/** Abbreviations the app uses that the official filenames spell out. */
const AWS_ALIASES = {
  sqs: 'AmazonSimpleQueueService',
  sns: 'AmazonSimpleNotificationService',
  elb: 'ElasticLoadBalancing',
  ebs: 'AmazonElasticBlockStore',
  kms: 'AWSKeyManagementService',
  qldb: 'AmazonQuantumLedgerDatabase',
  cdk: 'AWSCloudDevelopmentKit',
  snowfamily: 'AWSSnowball',
  quicksight: 'AmazonQuickSight',
  ses: 'AmazonSimpleEmailService',
  vpc: 'AmazonVirtualPrivateCloud',
  iam: 'AWSIdentityandAccessManagement',
  rds: 'AmazonRDS',
  emr: 'AmazonEMR',
  msk: 'AmazonManagedStreamingforApacheKafka',
  waf: 'AWSWAF',
};

function officialAwsIcons() {
  const byName = new Map();
  for (const entry of readdirSync(AWS_ICON_DIR, { recursive: true })) {
    const file = String(entry);
    if (!file.endsWith('.svg')) continue;
    const base = file.split('/').pop().replace('.svg', '');
    const normal = matchable(base);
    if (!byName.has(normal)) byName.set(normal, join(AWS_ICON_DIR, file));
  }
  return byName;
}

/** Extracts the drawing from an official file, keeping its 64x64 geometry. */
function innerSvg(path) {
  const source = readFileSync(path, 'utf8');
  const body = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return body.replace(/<title>[\s\S]*?<\/title>/g, '').trim();
}

function findOfficial(icons, label) {
  const target = matchable(label);
  const alias = AWS_ALIASES[target];
  if (alias && icons.has(matchable(alias))) return icons.get(matchable(alias));
  if (icons.has(target)) return icons.get(target);
  if (target.length < 5) return null;
  for (const [normal, path] of icons) {
    if (normal.length > 4 && (normal.includes(target) || target.includes(normal))) return path;
  }
  return null;
}

/**
 * The symbols the app already ships.
 *
 * Read from the committed file rather than the working tree, so re-running the
 * script cannot feed on its own output and cement a mistake.
 */
function existingSymbols() {
  let source;
  try {
    source = execFileSync('git', ['show', 'HEAD:src/components/icons/svgIconDefs.ts'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    source = readFileSync('src/components/icons/svgIconDefs.ts', 'utf8');
  }
  const symbols = new Map();
  for (const [, key, body] of source.matchAll(/<symbol id="i-([a-z0-9-]+)"([\s\S]*?)<\/symbol>/g)) {
    symbols.set(key, body);
  }
  return symbols;
}

const { services } = buildCatalog(MASTER_LIST);
const official = officialAwsIcons();
const existing = existingSymbols();

const symbols = new Map();
const stats = { existing: 0, official: 0, generated: 0 };

for (const service of services) {
  const category = canonicalCategory(service.category);

  const kept = existing.get(service.key);
  if (kept) {
    symbols.set(service.key, `<symbol id="i-${service.key}"${kept}</symbol>`);
    stats.existing++;
    continue;
  }

  if (service.cloud === 'aws') {
    const path = findOfficial(official, service.label);
    if (path) {
      symbols.set(
        service.key,
        `<symbol id="i-${service.key}" viewBox="0 0 64 64">${innerSvg(path)}</symbol>`,
      );
      stats.official++;
      continue;
    }
  }

  symbols.set(
    service.key,
    `<symbol id="i-${service.key}" viewBox="0 0 64 64">${renderMark(service.cloud, category)}</symbol>`,
  );
  stats.generated++;
}

const escape = (value) =>
  value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const output = [
  '// Auto-generated SVG icon definitions — do not edit manually.',
  '// Run: node scripts/buildIcons.mjs <path-to-cloud-services-master-list.md>',
  '//',
  '// Sources, in order of preference: the symbols the app already shipped, the',
  '// official AWS architecture icon set, and a generated mark carrying the',
  "// vendor's colour and the service's category for everything else.",
  '//',
  '// The arrowhead marker is not here: it is theme-dependent and lives in',
  '// src/components/editor/canvas/Defs.tsx.',
  '',
  '/** One `<symbol>` per service, keyed by service key. */',
  'export const SVG_SYMBOLS: Record<string, string> = {',
  ...[...symbols.entries()].map(([key, body]) => `  '${key}': \`${escape(body)}\`,`),
  '};',
  '',
  '/**',
  ' * Only the symbols a diagram actually uses.',
  ' *',
  ' * The full sprite is ~280KB and is inlined into every exported file and every',
  ' * embed image, so shipping all of it for a five-service diagram would make a',
  ' * README image two orders of magnitude larger than it needs to be.',
  ' */',
  'export function spriteFor(keys: Iterable<string>): string {',
  '  const seen = new Set<string>();',
  '  const parts: string[] = [];',
  '  for (const key of keys) {',
  '    if (seen.has(key)) continue;',
  '    seen.add(key);',
  '    const symbol = SVG_SYMBOLS[key];',
  '    if (symbol) parts.push(symbol);',
  '  }',
  "  return parts.join('\\n');",
  '}',
  '',
  '/** Every symbol. Used by the service browser, never by an export. */',
  "export const ALL_SYMBOLS: string = Object.values(SVG_SYMBOLS).join('\\n');",
  '',
].join('\n');

writeFileSync('src/components/icons/svgIconDefs.ts', output);
console.log('symbols:', services.length, JSON.stringify(stats));
console.log('sprite size:', Math.round(output.length / 1024), 'KB');
