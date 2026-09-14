import { fromCloudFormation } from './cloudformation';
import { fromCompose } from './compose';
import { fromKubernetes } from './kubernetes';
import { fromOpenApi } from './openapi';
import { fromPulumi } from './pulumi';
import { fromTerraform } from './terraform';
import { ImportError, type ImportFormat, type ImportResult } from './shared';
import type { Locale } from '@/lib/i18n/messages';

export { fromCloudFormation } from './cloudformation';
export { fromCompose } from './compose';
export { fromKubernetes } from './kubernetes';
export { fromOpenApi } from './openapi';
export { fromPulumi } from './pulumi';
export { fromTerraform } from './terraform';
export { ImportError } from './shared';
export type { ImportFormat, ImportResult, ImportWarning } from './shared';

/**
 * Which of the six a paste is.
 *
 * One box, not six tabs. Nobody arrives at this dialog unsure what they are
 * holding, so asking them to classify it first is asking them to do the
 * computer's job — and each format announces itself unmistakably in its first
 * few lines.
 *
 * The order is the point. The loud ones go first: a plan says
 * `planned_values`, a template says `AWS::`, a spec says `openapi:`. A
 * template comes before a spec because a SAM template carries a whole OpenAPI
 * description inside an API's `DefinitionBody`, `openapi:` line and all; and
 * Terraform comes before both because HCL can carry a whole template in a
 * heredoc. Compose goes last because its only tell is a top-level `services:`
 * — which nothing else here has, but which is too plain a word to trust
 * before everything else has had its say.
 *
 * Returns null rather than guessing when nothing matches, so the interface can
 * say what it accepts instead of failing halfway through the wrong reader.
 */
export function detectFormat(source: string): ImportFormat | null {
  const text = source.trim();
  if (!text) return null;

  // A plan is JSON with Terraform's own keys; HCL has `resource "type" "name"`.
  if (/"(planned_values|terraform_version|format_version)"\s*:/.test(text)) return 'terraform';
  if (/(^|\n)\s*(resource|module|provider)\s+"/.test(text)) return 'terraform';

  // A template states its version or its SAM transform, or has a top-level
  // `Resources` map of `AWS::` types. Top-level matters: a serverless.yml
  // nests `Resources:` under `resources:`, and a Compose file can carry one
  // under `x-aws-cloudformation:`, and neither is a template.
  if (/(^|[\n{,])\s*"?AWSTemplateFormatVersion"?\s*:\s*["']?\d/.test(text)) {
    return 'cloudformation';
  }
  if (/(^|[\n{,])\s*"?Transform"?\s*:\s*(?:\[|-)?\s*["']?AWS::Serverless/.test(text)) {
    return 'cloudformation';
  }
  if (
    /(^|\n)Resources\s*:|[{,\n]\s*"Resources"\s*:/.test(text) &&
    /(^|\n)\s*Type\s*:\s*["']?(AWS|Custom|Alexa)::|[{,\n]\s*"Type"\s*:\s*"(AWS|Custom|Alexa)::/.test(
      text,
    )
  ) {
    return 'cloudformation';
  }

  // `openapi: 3.1.0` or `"swagger": "2.0"`. A brace or comma counts as a
  // boundary as well as a newline, because minified JSON has no newlines at all.
  if (/(?:^|[\n{,])\s*"?(openapi|swagger)"?\s*:\s*"?\d/.test(text)) return 'openapi';

  // A URN is Pulumi's alone; an export with nothing in it still has the shape.
  if (/"urn:pulumi:/.test(text)) return 'pulumi';
  if (/"deployment"\s*:/.test(text) && /"resources"\s*:/.test(text)) return 'pulumi';
  if (/"steps"\s*:/.test(text) && /"urn"\s*:/.test(text)) return 'pulumi';

  // A manifest always carries both, and a stream of them carries them repeatedly.
  if (/(^|\n)\s*kind\s*:\s*\S/.test(text) && /(^|\n)\s*apiVersion\s*:\s*\S/.test(text)) {
    return 'kubernetes';
  }

  // A top-level `services:` map — a trailing comment allowed — in a file that
  // is not already something else: a DSL document has `nodes:` and never
  // `services:`.
  if (/(^|\n)services\s*:[ \t]*(#[^\n]*)?(\r?\n|$)/.test(text) && !/(^|\n)nodes\s*:/.test(text)) {
    return 'compose';
  }

  return null;
}

const READERS: Record<ImportFormat, (source: string, locale: Locale) => ImportResult> = {
  terraform: fromTerraform,
  cloudformation: fromCloudFormation,
  kubernetes: fromKubernetes,
  compose: fromCompose,
  pulumi: fromPulumi,
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
      'Not a Terraform plan, CloudFormation template, Kubernetes manifest, Compose file, Pulumi export or OpenAPI description.',
      'unrecognised',
    );
  }
  return READERS[chosen](source, locale);
}
