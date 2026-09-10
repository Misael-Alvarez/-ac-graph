import { buildCatalog, readExistingServices } from './buildCatalog.mjs';

/** Reports catalogue entries that look like two names for the same product. */
const { services } = buildCatalog(process.argv[2]);
const existing = new Set(readExistingServices().map((s) => s.key));

const byCloud = new Map();
for (const s of services) {
  const bucket = byCloud.get(s.cloud) ?? [];
  bucket.push(s);
  byCloud.set(s.cloud, bucket);
}

/** Longest common token overlap, as a crude sameness signal. */
const tokens = (label) =>
  new Set(
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter(
        (w) =>
          w.length > 2 &&
          ![
            'amazon',
            'aws',
            'azure',
            'google',
            'cloud',
            'oci',
            'oracle',
            'ibm',
            'for',
            'the',
          ].includes(w),
      ),
  );

let found = 0;
for (const [cloud, list] of byCloud) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = tokens(list[i].label);
      const b = tokens(list[j].label);
      if (!a.size || !b.size) continue;
      const shared = [...a].filter((t) => b.has(t));
      const ratio = shared.length / Math.min(a.size, b.size);
      if (ratio < 1) continue;
      const keep = existing.has(list[i].key) ? list[i] : existing.has(list[j].key) ? list[j] : null;
      found++;
      console.log(
        `${cloud.padEnd(7)} ${list[i].key.padEnd(26)} ${list[i].label.padEnd(34)} | ${list[j].key.padEnd(26)} ${list[j].label.padEnd(30)} ${keep ? `keep=${keep.key}` : ''}`,
      );
    }
  }
}
console.log('candidate duplicates:', found);
