import type { MessageKey } from '@/lib/i18n/messages';
import type { Finding, Severity } from './analysis';

/**
 * The words for what the analysis found.
 *
 * The engine returns a kind and its values, never a sentence — that is what lets
 * the same finding be read in two languages. But something has to hold the
 * mapping, and it must be *one* something: the insights panel and the CLI's
 * `check` both report the same findings, and two copies of this table would
 * drift the first time a check was added.
 */
export const FINDING_HEADLINE: Record<Finding['kind'], MessageKey> = {
  cycle: 'insight.cycle',
  singlePointOfFailure: 'insight.spof',
  orphan: 'insight.orphan',
  highCoupling: 'insight.coupling',
  unowned: 'insight.unowned',
  unauthenticatedData: 'insight.data',
};

export const SEVERITY_LABEL: Record<Severity, MessageKey> = {
  high: 'insight.high',
  medium: 'insight.medium',
  low: 'insight.low',
};

/** Worst first, which is the order anybody reading a list of problems wants. */
export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];
