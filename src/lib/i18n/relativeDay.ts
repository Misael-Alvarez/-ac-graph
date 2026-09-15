import type { MessageKey } from './messages';

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/**
 * "Today", "yesterday", "3 days ago" — and a date once that stops helping.
 *
 * Only the first week is worth phrasing: past that a date is the more precise
 * answer and reads no slower. Shared by the library, which labels a card, and
 * the history, which groups snapshots under the day they were taken.
 */
export function relativeDay(isoTimestamp: string, t: Translate, now = Date.now()): string {
  const at = new Date(isoTimestamp).getTime();
  if (Number.isNaN(at)) return '';
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return t('library.today');
  if (days === 1) return t('library.yesterday');
  if (days < 7) return t('library.daysAgo', { count: days });
  return new Date(at).toLocaleDateString();
}

/** Whether a moment is "today" in the sense above: less than a day old. */
export function withinADay(isoTimestamp: string, now = Date.now()): boolean {
  const at = new Date(isoTimestamp).getTime();
  return !Number.isNaN(at) && Math.floor((now - at) / 86_400_000) <= 0;
}
