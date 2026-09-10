import { readFileSync } from 'node:fs';

/**
 * Reads the cloud services master list.
 *
 * Two things come out of it: the per-cloud catalogue (sections 51-55), which is
 * the authoritative list of what exists, and the per-role comparison tables
 * (sections 1-49), which say which services play the same part in each cloud.
 */

export const CLOUDS = ['aws', 'azure', 'gcp', 'oci', 'ibm'];

const CLOUD_BY_HEADING = {
  AWS: 'aws',
  Azure: 'azure',
  GCP: 'gcp',
  OCI: 'oci',
  'IBM Cloud': 'ibm',
};

/** Column header spellings used across the comparison tables. */
const CLOUD_BY_COLUMN = {
  aws: 'aws',
  azure: 'azure',
  gcp: 'gcp',
  oci: 'oci',
  'ibm cloud': 'ibm',
  ibm: 'ibm',
};

export function parseMasterList(path) {
  const lines = readFileSync(path, 'utf8').split('\n');

  const catalogs = {};
  const roles = [];

  let cloud = null;
  let category = null;
  let section = null;
  let tableColumns = null;

  for (const raw of lines) {
    const line = raw.trim();

    const catalogHeading = line.match(/^# 5[1-5]\. (.+) Catalog$/);
    if (catalogHeading) {
      cloud = CLOUD_BY_HEADING[catalogHeading[1]] ?? null;
      if (cloud) catalogs[cloud] = {};
      category = null;
      tableColumns = null;
      continue;
    }

    const sectionHeading = line.match(/^# (\d+)\. (.+)$/);
    if (sectionHeading) {
      const number = Number(sectionHeading[1]);
      section = number <= 49 ? sectionHeading[2].trim() : null;
      if (number >= 51) cloud = cloud ?? null;
      if (number <= 50) cloud = null;
      tableColumns = null;
      continue;
    }
    if (line.startsWith('# ')) {
      cloud = null;
      section = null;
      tableColumns = null;
      continue;
    }

    if (cloud) {
      const categoryHeading = line.match(/^## (.+)$/);
      if (categoryHeading) {
        category = categoryHeading[1].trim();
        catalogs[cloud][category] ??= [];
        continue;
      }
      const bullet = line.match(/^- (.+)$/);
      if (bullet && category) catalogs[cloud][category].push(bullet[1].trim());
      continue;
    }

    if (section && line.startsWith('|')) {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;

      if (!tableColumns) {
        tableColumns = cells.map((c) => CLOUD_BY_COLUMN[c.toLowerCase()] ?? null);
        continue;
      }
      const role = cells[0];
      if (!role) continue;
      const entry = { section, role, services: {} };
      cells.forEach((cell, i) => {
        const column = tableColumns[i];
        if (!column || !cell || cell === '—' || cell === '-') return;
        entry.services[column] = cell;
      });
      if (Object.keys(entry.services).length) roles.push(entry);
    }
  }

  return { catalogs, roles };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { catalogs, roles } = parseMasterList(process.argv[2]);
  let total = 0;
  for (const [cloud, cats] of Object.entries(catalogs)) {
    const n = Object.values(cats).reduce((a, v) => a + v.length, 0);
    total += n;
    console.log(
      `${cloud.padEnd(6)} ${String(n).padStart(4)} services, ${Object.keys(cats).length} categories`,
    );
  }
  console.log('services total:', total);
  console.log('role rows:', roles.length);
  console.log('sections covered:', new Set(roles.map((r) => r.section)).size);
  console.log('sample role:', JSON.stringify(roles[0]));
}
