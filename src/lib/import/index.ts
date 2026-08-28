import { fromKubernetes } from './kubernetes';
import { fromOpenApi } from './openapi';
import { fromTerraform } from './terraform';
import { ImportError, type ImportFormat, type ImportResult } from './shared';
import type { Locale } from '@/lib/i18n/messages';

export { fromKubernetes } from './kubernetes';
export { fromOpenApi } from './openapi';
export { fromTerraform } from './terraform';
export { ImportError } from './shared';
export type { ImportFormat, ImportResult, ImportWarning } from './shared';

/**
 * Which of the three a paste is.
 *
 * One box, not three tabs. Nobody arrives at this dialog unsure what they are
 * holding, so asking them to classify it first is asking them to do the
 * computer's job — and each format announces itself unmistakably in its first
 * few lines.
 *
 * Returns null rather than guessing when nothing matches, so the interface can
 * say what it accepts instead of failing halfway through the wrong reader.
 */
export function detectFormat(source: string): ImportFormat | null {
  const text = source.trim();
  if (!text) return null;

  // `openapi: 3.1.0` or `"swagger": "2.0"`. A brace or comma counts as a
  // boundary as well as a newline, because minified JSON has no newlines at all.
  if (/(?:^|[\n{,])\s*"?(openapi|swagger)"?\s*:\s*"?\d/.test(text)) return 'openapi';

  // A plan is JSON with Terraform's own keys; HCL has `resource "type" "name"`.
  if (/"(planned_values|terraform_version|format_version)"\s*:/.test(text)) return 'terraform';
  if (/(^|\n)\s*(resource|module|provider)\s+"/.test(text)) return 'terraform';

  // A manifest always carries both, and a stream of them carries them repeatedly.
  if (/(^|\n)\s*kind\s*:\s*\S/.test(text) && /(^|\n)\s*apiVersion\s*:\s*\S/.test(text)) {
    return 'kubernetes';
  }

  return null;
}

const READERS: Record<ImportFormat, (source: string, locale: Locale) => ImportResult> = {
  terraform: fromTerraform,
  kubernetes: fromKubernetes,
  // The only reader with words of its own to write onto the diagram.
  openapi: fromOpenApi,
};

/**
 * Reads whatever this is into an architecture document.
 *
 * `format` overrides the sniffing, for the case where somebody knows better than
 * the heuristic — a Terraform plan trimmed down to the point of being
 * unrecognisable, say.
 */
export function importArchitecture(
  source: string,
  format?: ImportFormat,
  locale: Locale = 'en',
): ImportResult {
  const chosen = format ?? detectFormat(source);
  if (!chosen) {
    throw new ImportError(
      'Not a Terraform plan, Kubernetes manifest or OpenAPI description.',
      'unrecognised',
    );
  }
  return READERS[chosen](source, locale);
}
