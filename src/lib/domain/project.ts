/**
 * Workspace-level domain: the objects the browser store and the server API
 * share, so both speak exactly the same language.
 */
import { z } from 'zod';
import { DiagramModelSchema } from './diagram';

/** ISO-8601 timestamp. Stored as a string so it round-trips through JSON. */
const TimestampSchema = z.string();

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  avatarUrl: z.string().optional(),
});

/**
 * What one person may do with one diagram. The owner is the diagram's
 * `ownerId`, there is exactly one, and only the owner manages who else is in.
 * Editors change the diagram; viewers read it and are present in the room.
 */
export const RoleSchema = z.enum(['owner', 'editor', 'viewer']);

export const DiagramMetaSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  title: z.string(),
  description: z.string().default(''),
  folder: z.string().nullable().default(null),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  /** Inline SVG preview used by the library grid. */
  thumbnail: z.string().nullable().default(null),
  /**
   * A starting point rather than a piece of work: saved from a diagram to be
   * started from, shown among the templates on the home page and never in the
   * list of diagrams. Everything else about it — history, members, export —
   * is a diagram's, which is what lets a team share one (H1 #7) for free.
   * Absent on every record made before templates of one's own existed.
   */
  template: z.boolean().default(false),
  /**
   * The reader's own role. Set by the server, where diagrams have members;
   * absent in the browser-only store, where whoever holds the data owns it.
   */
  role: RoleSchema.optional(),
});

/** One person's access to one diagram, as the share dialog lists it. */
export const DiagramMemberSchema = z.object({
  user: UserSchema,
  role: RoleSchema,
  addedAt: TimestampSchema,
});

export const DiagramRecordSchema = DiagramMetaSchema.extend({
  model: DiagramModelSchema,
});

export const DiagramVersionSchema = z.object({
  id: z.string(),
  diagramId: z.string(),
  createdAt: TimestampSchema,
  /** Optional human label, e.g. "before switching to GCP". */
  label: z.string().nullable().default(null),
  model: DiagramModelSchema,
});

export const ShareSchema = z.object({
  id: z.string(),
  diagramId: z.string(),
  createdAt: TimestampSchema,
  /** Immutable snapshot: a share never changes when the diagram is edited. */
  model: DiagramModelSchema,
  theme: z.enum(['light', 'dark']).default('light'),
});

export type User = z.infer<typeof UserSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type DiagramMember = z.infer<typeof DiagramMemberSchema>;
export type DiagramMeta = z.infer<typeof DiagramMetaSchema>;
export type DiagramRecord = z.infer<typeof DiagramRecordSchema>;
export type DiagramVersion = z.infer<typeof DiagramVersionSchema>;
export type Share = z.infer<typeof ShareSchema>;
