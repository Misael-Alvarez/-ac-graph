/**
 * Editor-only types.
 *
 * These describe transient UI state and never reach persistence — that is the
 * domain layer's job (`@/lib/domain`). Keeping them apart stops view concerns
 * from leaking into the stored model.
 */
import type { CloudProvider, DiagramModel } from '@/lib/domain';

export type ToolMode =
  'select' | 'boundary' | 'subboundary' | 'group' | 'item' | 'connector' | 'pan';

/**
 * Whether exports carry the AION Cloud signature footer.
 *
 * One brand, on or off. The platform is AION Cloud's internal tool, so the only
 * question an export has to answer is whether it signs itself.
 */
export type BrandMode = 'aion' | 'none';

/** What an exported image is drawn on: the editor's current theme, or one chosen for paper. */
export type ExportTheme = 'editor' | 'light' | 'dark';

export interface EditorState {
  tool: ToolMode;
  selectedIds: Set<string>;
  connectorSourceId: string | null;
  zoom: number;
  gridSnap: boolean;
  darkMode: boolean;
  activeContainerId: string | null;
}

export interface ContextMenuState {
  x: number;
  y: number;
  shapeId?: string;
  connectorId?: string;
}

export interface InlineEditState {
  shapeId: string;
  field: 'title' | 'subtitle' | 'note';
  x: number;
  y: number;
  w: number;
}

export interface ServiceIcon {
  key: string;
  label: string;
  category: CloudProvider;
  subcategory?: string;
  description?: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  model: DiagramModel;
}
