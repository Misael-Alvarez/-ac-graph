/**
 * Name-to-icon lookup.
 *
 * Commands and templates are described as plain data in `.ts` files, which
 * cannot hold JSX, so they carry an icon *name* and the rendering happens here.
 * An unknown name falls back to a neutral mark rather than rendering nothing,
 * because a missing icon collapses the row and knocks the whole list out of
 * alignment.
 */
import {
  ArrowLeftIcon,
  SearchIcon,
  AutoLayoutIcon,
  BoltIcon,
  BrainIcon,
  ChartIcon,
  CloudIcon,
  CodeIcon,
  DeselectIcon,
  DownloadIcon,
  DuplicateIcon,
  EraseIcon,
  FitIcon,
  PresentIcon,
  FolderIcon,
  GridIcon,
  ImportIcon,
  ItemIcon,
  KeyboardIcon,
  LayersIcon,
  LayoutIcon,
  ListIcon,
  LockIcon,
  MapIcon,
  MeshIcon,
  MoonIcon,
  PlusIcon,
  RedoIcon,
  SaveIcon,
  SelectAllIcon,
  ShareIcon,
  SparkleIcon,
  SunIcon,
  TemplateIcon,
  TrashIcon,
  UndoIcon,
  UnlockIcon,
  HistoryIcon,
  CommentIcon,
  ZoomOutIcon,
} from './ToolIcons';

type IconComponent = (props: { size?: number; className?: string }) => React.ReactElement;

const ICONS: Record<string, IconComponent> = {
  undo: UndoIcon,
  redo: RedoIcon,
  selectAll: SelectAllIcon,
  deselect: DeselectIcon,
  delete: TrashIcon,
  duplicate: DuplicateIcon,
  lock: LockIcon,
  unlock: UnlockIcon,
  autoLayout: AutoLayoutIcon,
  zoomFit: FitIcon,
  present: PresentIcon,
  zoomReset: ZoomOutIcon,
  sun: SunIcon,
  moon: MoonIcon,
  grid: GridIcon,
  code: CodeIcon,
  browser: LayoutIcon,
  history: HistoryIcon,
  comments: CommentIcon,
  minimap: MapIcon,
  ai: SparkleIcon,
  templates: TemplateIcon,
  cloud: CloudIcon,
  import: ImportIcon,
  share: ShareIcon,
  export: DownloadIcon,
  open: FolderIcon,
  save: SaveIcon,
  shortcuts: KeyboardIcon,
  clear: EraseIcon,
  back: ArrowLeftIcon,
  plus: PlusIcon,
  list: ListIcon,
  search: SearchIcon,
  // Template glyphs.
  bolt: BoltIcon,
  mesh: MeshIcon,
  chart: ChartIcon,
  brain: BrainIcon,
  layers: LayersIcon,
};

export function Glyph({
  name,
  size = 18,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Component = ICONS[name] ?? ItemIcon;
  return <Component size={size} className={className} />;
}
