/**
 * Canonical categories.
 *
 * The app's own subcategories and the master list's headings say the same things
 * in different words — "AI / ML", "ML/AI" and "AI" are one category, as are
 * "Database" and "Databases". Folding them here is what lets the browser show
 * one clean set of sections per cloud instead of thirty near-duplicates.
 */
export const CATEGORIES = [
  { id: 'compute', label: 'Compute' },
  { id: 'containers', label: 'Containers' },
  { id: 'serverless', label: 'Serverless' },
  { id: 'storage', label: 'Storage' },
  { id: 'database', label: 'Databases' },
  { id: 'analytics', label: 'Analytics & Data' },
  { id: 'ai', label: 'AI & Machine Learning' },
  { id: 'integration', label: 'Integration & Messaging' },
  { id: 'networking', label: 'Networking' },
  { id: 'security', label: 'Security & Identity' },
  { id: 'devops', label: 'DevOps' },
  { id: 'management', label: 'Management & Observability' },
  { id: 'iot', label: 'IoT & Edge' },
  { id: 'other', label: 'Other' },
];

const ALIASES = {
  compute: 'compute',
  containers: 'containers',
  serverless: 'serverless',
  storage: 'storage',
  database: 'database',
  databases: 'database',
  analytics: 'analytics',
  data: 'analytics',
  'data / analytics': 'analytics',
  'analytics / data': 'analytics',
  'ai / ml': 'ai',
  'ml/ai': 'ai',
  ai: 'ai',
  'ai / machine learning': 'ai',
  integration: 'integration',
  'app integration': 'integration',
  messaging: 'integration',
  networking: 'networking',
  security: 'security',
  'identity / security': 'security',
  'security & identity': 'security',
  devops: 'devops',
  management: 'management',
  'management / governance': 'management',
  'operations / governance': 'management',
  monitoring: 'management',
  observability: 'management',
  automation: 'management',
  hybrid: 'compute',
  iot: 'iot',
  devices: 'iot',
  actors: 'other',
  general: 'other',
};

export function canonicalCategory(raw) {
  return (
    ALIASES[
      String(raw ?? '')
        .trim()
        .toLowerCase()
    ] ?? 'other'
  );
}
