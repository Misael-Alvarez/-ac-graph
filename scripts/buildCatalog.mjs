import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseMasterList } from './parseMasterList.mjs';

/**
 * Builds the service catalogue as the union of what the app already ships and
 * what the master list adds.
 *
 * A union, not a replacement: stored diagrams reference the keys the app shipped
 * with, and the master list turns out not to contain everything the app had —
 * API Gateway is missing from it entirely. Replacing would have quietly broken
 * existing diagrams and removed working services.
 */

const PREFIX = { aws: 'aws', azure: 'az', gcp: 'gcp', oci: 'oci', ibm: 'ibm' };
const CLOUD_BY_PREFIX = { aws: 'aws', az: 'azure', gcp: 'gcp', oci: 'oci', ibm: 'ibm' };

/** Vendor and filler words that carry no meaning inside a key. */
const NOISE = new Set([
  'amazon',
  'aws',
  'azure',
  'google',
  'cloud',
  'oci',
  'oracle',
  'ibm',
  'microsoft',
  'for',
  'and',
  'the',
  'service',
  'services',
]);

export function slugify(label) {
  const words = label
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const meaningful = words.filter((w) => !NOISE.has(w));
  return (meaningful.length ? meaningful : words).join('');
}

/** Normalised form used to decide whether two names are the same product. */
export function matchable(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^(amazon|aws|azure|google|oci|oracle|ibm|microsoft)/, '');
}

/**
 * The app's catalogue as committed.
 *
 * Read from git rather than the working tree so re-running cannot feed on its
 * own output: the second run would otherwise treat generated entries as
 * pre-existing and quietly cement any mistake in the first.
 */
export function readExistingServices(path = 'src/data/serviceIcons.ts') {
  let source;
  try {
    source = execFileSync('git', ['show', `HEAD:${path}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    source = readFileSync(path, 'utf8');
  }
  const entries = [];
  const rowPattern = /\{\s*key: '([^']+)'[^}]*?\}/g;
  for (const [row, key] of source.matchAll(rowPattern)) {
    const field = (name) => row.match(new RegExp(`${name}: '((?:[^'\\\\]|\\\\.)*)'`))?.[1];
    entries.push({
      key,
      label: field('label') ?? key,
      category: field('category') ?? 'generic',
      subcategory: field('subcategory'),
      description: field('description'),
    });
  }
  return entries;
}

/**
 * Products the vendor renamed, where the master list and the app use different
 * names for one thing.
 *
 * Declared rather than inferred: name similarity cannot tell a rename apart from
 * a genuinely separate product — "Vertex AI" and "Vertex AI Workbench" look just
 * as close as the pairs below, and merging those would be wrong.
 */
const RENAMES = [
  { cloud: 'gcp', from: 'Cloud Run Functions', to: 'Cloud Functions' },
  { cloud: 'gcp', from: 'Spanner', to: 'Cloud Spanner' },
  { cloud: 'gcp', from: 'Cloud Load Balancing', to: 'Load Balancing' },
];

export function buildCatalog(masterListPath) {
  const { catalogs, roles } = parseMasterList(masterListPath);
  const existing = readExistingServices();

  const services = [];
  const usedKeys = new Set();
  /** cloud -> normalised label -> key, for deduplication and role matching. */
  const index = new Map();

  const remember = (cloud, label, key) => {
    const bucket = index.get(cloud) ?? new Map();
    const normal = matchable(label);
    if (normal && !bucket.has(normal)) bucket.set(normal, key);
    index.set(cloud, bucket);
  };

  // Everything the app already has keeps its key, its label and its wording.
  for (const service of existing) {
    usedKeys.add(service.key);
    const cloud = CLOUD_BY_PREFIX[service.key.split('-')[0]] ?? null;
    services.push({
      key: service.key,
      label: service.label,
      cloud: service.category,
      category: service.subcategory ?? 'General',
      description: service.description ?? '',
      source: 'existing',
    });
    if (cloud) remember(cloud, service.label, service.key);
  }

  /**
   * Finds an existing entry for the same product.
   *
   * Exact match first. The fallback only accepts a name that extends another by
   * a few characters — "Amazon SageMaker AI" is the same product as "SageMaker",
   * but "Cloud Run Functions" is emphatically not "Cloud Run", and a plain
   * substring test cannot tell those apart.
   */
  const NEAR = 4;
  const findSame = (cloud, label) => {
    const bucket = index.get(cloud);
    if (!bucket) return null;
    const target = matchable(label);
    if (bucket.has(target)) return bucket.get(target);
    if (target.length < 5) return null;

    let best = null;
    for (const [normal, key] of bucket) {
      if (normal.length < 5) continue;
      const [shorter, longer] =
        normal.length <= target.length ? [normal, target] : [target, normal];
      if (!longer.startsWith(shorter)) continue;
      const delta = longer.length - shorter.length;
      if (delta > NEAR) continue;
      if (!best || delta < best.delta) best = { key, delta };
    }
    return best?.key ?? null;
  };

  let added = 0;
  let merged = 0;
  for (const [cloud, categories] of Object.entries(catalogs)) {
    for (const [category, labels] of Object.entries(categories)) {
      for (const label of labels) {
        const rename = RENAMES.find((r) => r.cloud === cloud && r.from === label);
        const same = findSame(cloud, rename ? rename.to : label);
        if (same) {
          // Adopt the master list's category, which is more consistent than the
          // ad-hoc subcategories the app grew organically.
          const service = services.find((s) => s.key === same);
          if (service && service.category === 'General') service.category = category;
          merged++;
          continue;
        }
        let key = `${PREFIX[cloud]}-${slugify(label)}`;
        if (usedKeys.has(key)) {
          let n = 2;
          while (usedKeys.has(`${key}${n}`)) n++;
          key = `${key}${n}`;
        }
        usedKeys.add(key);
        services.push({ key, label, cloud, category, description: '', source: 'master' });
        remember(cloud, label, key);
        added++;
      }
    }
  }

  // Cross-cloud roles, resolved onto catalogue keys. Renames apply here too, or
  // a role row would point at a name the catalogue deliberately folded away.
  const resolve = (cloud, name) => {
    const rename = RENAMES.find((r) => r.cloud === cloud && r.from === name);
    const base = rename ? rename.to : name;
    for (const candidate of [base, base.split('/')[0].trim()]) {
      const hit = findSame(cloud, candidate);
      if (hit) return hit;
    }
    return null;
  };

  const equivalences = [];
  let matched = 0;
  let attempted = 0;
  for (const row of roles) {
    const entry = { section: row.section, role: row.role, services: {} };
    for (const [cloud, name] of Object.entries(row.services)) {
      attempted++;
      const key = resolve(cloud, name);
      if (key) {
        entry.services[cloud] = key;
        matched++;
      }
    }
    if (Object.keys(entry.services).length >= 2) equivalences.push(entry);
  }

  return {
    services,
    equivalences,
    stats: { existing: existing.length, added, merged, matched, attempted },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { services, equivalences, stats } = buildCatalog(process.argv[2]);
  console.log('total services:', services.length);
  console.log(
    '  from the app:',
    stats.existing,
    '· added:',
    stats.added,
    '· merged:',
    stats.merged,
  );
  console.log('equivalence rows:', equivalences.length);
  console.log(
    `role names matched: ${stats.matched}/${stats.attempted} (${Math.round((stats.matched / stats.attempted) * 100)}%)`,
  );
  const byCloud = {};
  for (const s of services) byCloud[s.cloud] = (byCloud[s.cloud] ?? 0) + 1;
  console.log('by cloud:', JSON.stringify(byCloud));
  const existingKeys = new Set(readExistingServices().map((s) => s.key));
  const kept = services.filter((s) => existingKeys.has(s.key)).length;
  console.log(`existing keys preserved: ${kept}/${existingKeys.size}`);
}
