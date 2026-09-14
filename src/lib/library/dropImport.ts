import { safeParseDiagramModel, type DiagramModel } from '@/lib/domain';
import { compile, parseDsl } from '@/lib/dsl';
import { fromMermaid } from '@/lib/dsl/mermaid';
import { markdownToDiagram } from '@/lib/editor/markdownImport';
import type { Locale } from '@/lib/i18n/messages';
import {
  ImportError,
  detectFormat,
  importArchitecture,
  type ImportFormat,
  type ImportResult,
} from '@/lib/import';
import type { WorkspaceExport } from '@/lib/store/types';

/**
 * A file dropped on the library, read as whatever it turns out to be.
 *
 * The person does not have to say what the file is: a project export, a
 * whole-workspace dump, a DSL document, a Mermaid flowchart, Terraform,
 * CloudFormation, a Kubernetes manifest, a Compose file, a Pulumi export, an
 * OpenAPI description or a Markdown outline are told apart by their contents,
 * in the order in which telling them apart is cheapest and least ambiguous.
 * What cannot be told apart is refused with a reason rather than drawn wrong.
 */
export type DroppedFormat = 'json' | 'workspace' | 'dsl' | 'mermaid' | 'markdown' | ImportFormat;

export type DroppedImport =
  | { kind: 'workspace'; data: WorkspaceExport }
  | { kind: 'diagram'; title: string; model: DiagramModel; format: DroppedFormat };

export class DropImportError extends Error {
  constructor(readonly code: 'empty' | 'unreadable' | 'unrecognised') {
    super(`Could not import the dropped file: ${code}`);
    this.name = 'DropImportError';
  }
}

/** The file's name without its extension, as the new diagram's title. */
export function titleFromFileName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '').trim();
  return stem || 'Imported';
}

export function readDroppedFile(name: string, text: string, locale: Locale): DroppedImport {
  const source = text.trim();
  if (!source) throw new DropImportError('empty');
  const title = titleFromFileName(name);

  // Infrastructure first, JSON or not: a Terraform plan, a CloudFormation
  // template and a Pulumi export all arrive as JSON, and treating every brace
  // as a project export would refuse all three as "not a diagram".
  const format = detectFormat(source);
  if (format) {
    let imported: ImportResult;
    try {
      imported = importArchitecture(source, format, locale);
    } catch (thrown) {
      throw new DropImportError(thrown instanceof ImportError ? thrown.code : 'unrecognised');
    }
    const { model } = compile(imported.document, locale);
    // A file that is all plumbing — an IAM-only template, `services: {}` —
    // reads fine and draws nothing. The dialog shows that as "0 services" and
    // withholds the button; here the equivalent is to say so rather than file
    // a blank diagram under the file's name.
    if (!model.shapes.length) throw new DropImportError('empty');
    return { kind: 'diagram', title, model, format };
  }

  if (source.startsWith('{') || source.startsWith('[')) return fromJson(source, title);

  if (/^\s*(?:%%.*\n\s*)*(?:flowchart|graph)\s+\w/.test(source)) {
    const { model } = fromMermaid(source, locale);
    if (model.shapes.length) return { kind: 'diagram', title, model, format: 'mermaid' };
  }

  const dsl = parseDsl(source, locale);
  if (dsl.model && dsl.model.shapes.length) {
    return { kind: 'diagram', title, model: dsl.model, format: 'dsl' };
  }

  if (/\.(md|markdown|txt)$/i.test(name) || /^\s*#\s|\n\s*[-*]\s+\S/.test(source)) {
    const model = markdownToDiagram(source, locale);
    if (model.shapes.length) return { kind: 'diagram', title, model, format: 'markdown' };
  }

  throw new DropImportError('unrecognised');
}

function fromJson(source: string, title: string): DroppedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new DropImportError('unreadable');
  }
  if (isWorkspaceDump(parsed)) return { kind: 'workspace', data: parsed };

  const model = safeParseDiagramModel(parsed);
  if (model.success) return { kind: 'diagram', title, model: model.data, format: 'json' };

  // A stored record: the model inside, the title it already had.
  if (parsed && typeof parsed === 'object' && 'model' in parsed) {
    const record = parsed as { model: unknown; title?: unknown };
    const inner = safeParseDiagramModel(record.model);
    if (inner.success) {
      return {
        kind: 'diagram',
        title: typeof record.title === 'string' && record.title.trim() ? record.title : title,
        model: inner.data,
        format: 'json',
      };
    }
  }
  throw new DropImportError('unrecognised');
}

function isWorkspaceDump(value: unknown): value is WorkspaceExport {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { diagrams?: unknown }).diagrams) &&
    Array.isArray((value as { versions?: unknown }).versions)
  );
}
