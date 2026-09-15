import { z } from 'zod';
import {
  CommentAnchorSchema,
  DiagramModelSchema,
  DiagramRecordSchema,
  DiagramVersionSchema,
} from '@/lib/domain';

/**
 * Request bodies of the diagram API.
 *
 * Every model crossing the wire goes through `DiagramModelSchema`, the same
 * gate the editor uses for file import, so a malformed payload is refused with
 * a 400 instead of reaching the database.
 */
export const CreateDiagramBodySchema = z.object({
  title: z.string().min(1).max(500),
  model: DiagramModelSchema,
  description: z.string().max(5000).optional(),
  folder: z.string().max(500).nullable().optional(),
  template: z.boolean().optional(),
});

export const MetaPatchSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).optional(),
    folder: z.string().max(500).nullable().optional(),
    thumbnail: z.string().nullable().optional(),
  })
  .strict();

export const SaveOptionsSchema = z
  .object({
    snapshot: z.boolean().optional(),
    snapshotModel: DiagramModelSchema.optional(),
    label: z.string().max(500).optional(),
    metadata: MetaPatchSchema.omit({ thumbnail: true }).optional(),
    expectedUpdatedAt: z.string().optional(),
  })
  .strict();

export const SaveBodySchema = z.object({
  model: DiagramModelSchema,
  options: SaveOptionsSchema.optional(),
});

/**
 * What to call the copy, in the interface's language. The body is optional
 * altogether — a bare POST still duplicates, titled "… copy" — but a title
 * sent is a title: not blank, and no longer than a name should be.
 */
export const DuplicateBodySchema = z
  .object({ title: z.string().trim().min(1).max(200).optional() })
  .strict();

export const PresenceBodySchema = z
  .object({
    cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional(),
    editing: z.boolean().optional(),
  })
  .strict();

/** Who to let in and how far. The owner is never set through here. */
export const MemberBodySchema = z
  .object({
    email: z.string().trim().email().max(320),
    role: z.enum(['editor', 'viewer']),
  })
  .strict();

export const MemberRoleSchema = z.object({ role: z.enum(['editor', 'viewer']) }).strict();

export const WorkspaceImportSchema = z.object({
  exportedAt: z.string(),
  diagrams: z.array(DiagramRecordSchema),
  versions: z.array(DiagramVersionSchema),
});

/**
 * A comment as written: where, and what. The author is never in the body —
 * the session signs — and a thread is opened with one comment, so `body` is
 * required and bounded like the domain's own.
 */
export const ThreadBodySchema = z
  .object({
    anchor: CommentAnchorSchema,
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

export const ReplyBodySchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();

export const ThreadPatchSchema = z.object({ resolved: z.boolean() }).strict();
