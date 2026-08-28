import { SERVICE_CATEGORIES, SERVICE_ICONS } from '@/data/serviceIcons';
import { serviceAreaLabel, serviceDescriptions } from '@/lib/i18n/serviceCopy';
import type { Locale } from '@/lib/i18n/messages';
import { scoreMatch } from './search';
import type { ServiceIcon } from './types';

/**
 * The service catalogue, queried.
 *
 * The browser and the icon picker ask the same question of the same 572
 * services — one cloud at a time while browsing, every cloud at once while
 * searching — and each answered it with its own copy of the same thirty lines.
 * Both copies shared a flaw: a relevance rank was computed and then thrown away
 * by sorting every section alphabetically, so searching `lambda` could file the
 * exact match three sections below a service that merely mentions it.
 *
 * Here the ranking survives. Alphabetical order is right for browsing, where
 * the reader is scanning for a name they may not know; it is wrong for
 * searching, where they have already said what they want.
 */

export interface CatalogSection {
  /** The functional area: `compute`, `storage`, … */
  id: string;
  label: string;
  services: ServiceIcon[];
}

export interface CatalogResult {
  sections: CatalogSection[];
  /** How many services the sections hold, after the cap. */
  shown: number;
  /** How many matched, before it. */
  total: number;
  searching: boolean;
}

/** A one-letter search matches most of the catalogue; the rest are one word away. */
export const MAX_CATALOG_RESULTS = 120;

/** Services per cloud. Fixed data, so counted once rather than once per mount. */
export const SERVICES_PER_CLOUD: ReadonlyMap<string, number> = (() => {
  const counts = new Map<string, number>();
  for (const service of SERVICE_ICONS) {
    counts.set(service.category, (counts.get(service.category) ?? 0) + 1);
  }
  return counts;
})();

const AREA_LABELS = new Map(SERVICE_CATEGORIES.map((category) => [category.id, category.label]));
const AREA_ORDER = new Map(SERVICE_CATEGORIES.map((category, index) => [category.id, index]));

/**
 * The area a service is filed under.
 *
 * An area the catalogue does not know lands in "Other" rather than being
 * dropped: the generated data can name a new one at any time, and a service
 * missing from the browser is worse than one filed loosely.
 */
function areaOf(service: ServiceIcon): string {
  const area = service.subcategory ?? 'other';
  return AREA_LABELS.has(area) ? area : 'other';
}

function rankOf(service: ServiceIcon, needle: string): number {
  return Math.max(
    scoreMatch(service.label, needle),
    scoreMatch(service.key, needle),
    // Every language, not the reader's: someone who thinks in English while
    // working in a Spanish interface should still find the cache layer by
    // typing "cache", and the reverse. Halved so that the best description
    // match still loses to the weakest name match — what a service is called
    // is stronger evidence than what it is said to do.
    ...serviceDescriptions(service).map((text) => scoreMatch(text, needle) * 0.5),
  );
}

const byLabel = (a: ServiceIcon, b: ServiceIcon) => a.label.localeCompare(b.label);

/** Groups into sections, preserving the order the services arrive in. */
function sectionsOf(services: ServiceIcon[], locale: Locale): CatalogSection[] {
  const grouped = new Map<string, ServiceIcon[]>();
  for (const service of services) {
    const area = areaOf(service);
    const bucket = grouped.get(area);
    if (bucket) bucket.push(service);
    else grouped.set(area, [service]);
  }
  return [...grouped].map(([id, list]) => ({
    id,
    label: serviceAreaLabel(id, AREA_LABELS.get(id) ?? id, locale),
    services: list,
  }));
}

export interface CatalogQuery {
  /** The cloud tab, which only applies while browsing. */
  cloud: string;
  query: string;
  /** How many search results to keep. Browsing is never capped. */
  limit?: number;
  /** Names the section headings. Ranking is language-agnostic on purpose. */
  locale?: Locale;
}

export function queryCatalog({
  cloud,
  query,
  limit = MAX_CATALOG_RESULTS,
  locale = 'en',
}: CatalogQuery): CatalogResult {
  const needle = query.trim().toLowerCase();

  if (!needle) {
    const pool = SERVICE_ICONS.filter((service) => service.category === cloud);
    const sections = sectionsOf(pool, locale)
      .map((section) => ({ ...section, services: [...section.services].sort(byLabel) }))
      .sort(
        (a, b) =>
          (AREA_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (AREA_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      );
    return { sections, shown: pool.length, total: pool.length, searching: false };
  }

  const ranked: { service: ServiceIcon; rank: number }[] = [];
  for (const service of SERVICE_ICONS) {
    const rank = rankOf(service, needle);
    if (rank > 0) ranked.push({ service, rank });
  }
  ranked.sort((a, b) => b.rank - a.rank || byLabel(a.service, b.service));

  const kept = ranked.slice(0, limit).map((entry) => entry.service);
  // Insertion order carries the ranking through the grouping: the sections come
  // out best-match first, and so do the services inside each one.
  return {
    sections: sectionsOf(kept, locale),
    shown: kept.length,
    total: ranked.length,
    searching: true,
  };
}
