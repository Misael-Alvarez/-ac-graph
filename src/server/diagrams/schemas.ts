import { z } from 'zod';
import { DiagramModelSchema, DiagramRecordSchema, DiagramVersionSchema } from '@/lib/domain';

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

export const PresenceBodySchema = z
  .object({
    cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional(),
    editing: z.boolean().optional(),
  })
  .strict();

export const WorkspaceImportSchema = z.object({
  exportedAt: z.string(),
  diagrams: z.array(DiagramRecordSchema),
  versions: z.array(DiagramVersionSchema),
});
