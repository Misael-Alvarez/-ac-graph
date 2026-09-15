/**
 * Line icons for the tool dock and chrome.
 *
 * These replace the emoji the previous toolbar used: emoji render at different
 * sizes and baselines on every platform, so the dock never lined up, and they
 * cannot inherit the current colour.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function Icon({ size = 18, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SelectIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 3l7.5 17 2.3-6.9 6.9-2.3z" />
  </Icon>
);

export const BoundaryIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 9.5h18" />
  </Icon>
);

export const SubBoundaryIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2.5" strokeDasharray="3 2.5" />
    <path d="M3 9.5h18" />
  </Icon>
);

export const GroupIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <rect x="6" y="9" width="12" height="3.2" rx="1" />
    <rect x="6" y="14" width="12" height="3.2" rx="1" />
  </Icon>
);

export const ItemIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7" width="18" height="10" rx="2.5" />
    <path d="M12 10.5v3M10.5 12h3" />
  </Icon>
);

export const ConnectorIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="5.5" r="2.5" />
    <path d="M7.5 16.5l9-9" />
  </Icon>
);

/** A tinted zone: a dashed panel with a corner tab, nothing inside it. */
export const RegionIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" strokeDasharray="3 2.5" />
    <path d="M6.5 8h5" />
  </Icon>
);

/** A square of paper with its corner turned up. */
export const NoteIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v8.5l-6 6H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M14 20v-4.5a1.5 1.5 0 0 1 1.5-1.5H20" />
    <path d="M8 9h8M8 12.5h5" />
  </Icon>
);

/** The letter T on a baseline: free text. */
export const TextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 6.5V4.5h14v2" />
    <path d="M12 4.5v15" />
    <path d="M9 19.5h6" />
  </Icon>
);

export const UndoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-3" />
  </Icon>
);

export const RedoIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 000 12h3" />
  </Icon>
);

export const ZoomInIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.6-3.6M11 8.5v5M8.5 11h5" />
  </Icon>
);

export const ZoomOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.6-3.6M8.5 11h5" />
  </Icon>
);

export const FitIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" />
  </Icon>
);

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.6-3.6" />
  </Icon>
);

export const LayoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Icon>
);

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
  </Icon>
);

/** A speech bubble: what people say about the drawing. */
export const CommentIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" />
    <path d="M8 8.5h8M8 12h5" />
  </Icon>
);

/** A pencil: open to change. */
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 5.5l4 4L8 20H4v-4z" />
    <path d="M12.5 7.5l4 4" />
  </Icon>
);

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M15 9V5a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h4" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
  </Icon>
);

export const GridIcon = (p: IconProps) => (
  <Icon {...p}>
    <path
      d="M4 4h.01M12 4h.01M20 4h.01M4 12h.01M12 12h.01M20 12h.01M4 20h.01M12 20h.01M20 20h.01"
      strokeWidth={2.6}
    />
  </Icon>
);

export const MapIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 4L3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" />
    <path d="M9 4v13M15 6.5v13" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const CloudIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 18a4 4 0 01-.6-7.95A5.5 5.5 0 0117.3 9 3.5 3.5 0 0117 18z" />
  </Icon>
);

export const TemplateIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M9 9v11" />
  </Icon>
);

/* ── Command palette, library and dialogs ─────────────────────────────
   Everything below replaces a text glyph or an emoji that the palette and
   the template cards used to print: ▣ ⧉ 🗺 ⚡ 🧠 render at a different size
   and baseline on every platform and cannot take the current colour, so a
   list of them never lined up with the SVG icons beside it. */

export const SelectAllIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2.5" />
    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const DeselectIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 2.5" />
  </Icon>
);

export const DuplicateIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="13" height="13" rx="2" />
    <path d="M8 21h11a2 2 0 002-2V8" />
  </Icon>
);

export const AutoLayoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="7" height="7" rx="1.5" />
    <rect x="14" y="4" width="7" height="7" rx="1.5" />
    <rect x="8.5" y="15" width="7" height="5" rx="1.5" />
    <path d="M6.5 11v2.5h11V11M12 13.5V15" />
  </Icon>
);

export const SparkleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Icon>
);

export const CodeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6l-5 6 5 6M15 6l5 6-5 6" />
  </Icon>
);

export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12a8.5 8.5 0 108.5-8.5A8.5 8.5 0 005.6 6.6" />
    <path d="M3.5 3.5v3.5H7" />
    <path d="M12 7.5V12l3 1.8" />
  </Icon>
);

export const ShareIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 15V3.5M8.5 7L12 3.5 15.5 7" />
    <path d="M4.5 13.5V19a2 2 0 002 2h11a2 2 0 002-2v-5.5" />
  </Icon>
);

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5V15M8.5 11.5L12 15l3.5-3.5" />
    <path d="M4.5 15.5V19a2 2 0 002 2h11a2 2 0 002-2v-3.5" />
  </Icon>
);

/* An arrow up out of the tray: a file coming in. The mirror of DownloadIcon,
   so import and export beside each other never read as the same button. */
export const ImportIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 15V3.5M8.5 7L12 3.5 15.5 7" />
    <path d="M4.5 15.5V19a2 2 0 002 2h11a2 2 0 002-2v-3.5" />
  </Icon>
);

export const FolderIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
  </Icon>
);

export const SaveIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3.5h11L20.5 8v11.5a1.5 1.5 0 01-1.5 1.5H5a1.5 1.5 0 01-1.5-1.5v-15A1.5 1.5 0 015 3.5z" />
    <path d="M8 3.5v5h7M8 20v-5.5h8V20" />
  </Icon>
);

export const KeyboardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M8 14.5h8" strokeWidth={2.2} />
  </Icon>
);

export const EraseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 21l-3.5-3.5a2 2 0 010-2.8L13 5.2a2 2 0 012.8 0l4.5 4.5a2 2 0 010 2.8L13.5 19.5" />
    <path d="M21 21H8" />
  </Icon>
);

export const ListIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6.5h16M4 12h16M4 17.5h10" />
  </Icon>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Icon>
);

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12.5l5 5 10-11" />
  </Icon>
);

/* Template glyphs — one per starting point, drawn in the same line idiom. */

export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 2.5L4.5 13.5h6l-.5 8 9-11h-6z" />
  </Icon>
);

export const MeshIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="4.5" r="2.2" />
    <circle cx="4.5" cy="17" r="2.2" />
    <circle cx="19.5" cy="17" r="2.2" />
    <path d="M10.4 6.3L6 14.9M13.6 6.3L18 14.9M6.7 17h10.6" />
  </Icon>
);

export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 20v-6M12.5 20V9M17 20v-9.5" strokeWidth={2.4} />
  </Icon>
);

export const BrainIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="2.6" />
    <circle cx="17" cy="7" r="2.6" />
    <circle cx="12" cy="17" r="2.6" />
    <path d="M9.6 7h4.8M8.3 9.3l2.4 5.4M15.7 9.3l-2.4 5.4" />
  </Icon>
);

export const LayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l8.5 4.5L12 12 3.5 7.5z" />
    <path d="M3.5 12L12 16.5 20.5 12M3.5 16.5L12 21l8.5-4.5" />
  </Icon>
);

/* Export formats and account, for the top bar menus. */

export const FileTextIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5h8l4.5 4.5v12a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 20V5A1.5 1.5 0 016 3.5z" />
    <path d="M14 3.5V8h4.5M8 12.5h8M8 16h5" />
  </Icon>
);

export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M20.5 15.5l-4.5-4.5-8 8.5" />
  </Icon>
);

export const VectorIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 18c4-9 12-9 16 0" />
    <rect x="2.5" y="16.5" width="3" height="3" rx="0.6" />
    <rect x="18.5" y="16.5" width="3" height="3" rx="0.6" />
    <rect x="10.5" y="9.5" width="3" height="3" rx="0.6" />
    <path d="M12 9.5V5.5" />
  </Icon>
);

export const BracesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 4.5c-2 0-3 1-3 3v2.3c0 1.2-.8 2.2-2 2.2 1.2 0 2 1 2 2.2v2.3c0 2 1 3 3 3" />
    <path d="M16 4.5c2 0 3 1 3 3v2.3c0 1.2.8 2.2 2 2.2-1.2 0-2 1-2 2.2v2.3c0 2-1 3-3 3" />
  </Icon>
);

export const DocumentIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M8 8h8M8 11.5h8M8 15h5" />
  </Icon>
);

export const PrintIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 8V4.5h10V8" />
    <rect x="3.5" y="8" width="17" height="8.5" rx="2" />
    <path d="M7 14h10v5.5H7z" />
  </Icon>
);

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6" />
  </Icon>
);

export const LogOutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5H6a2 2 0 00-2 2v11a2 2 0 002 2h4" />
    <path d="M14.5 8l4 4-4 4M18.5 12H9" />
  </Icon>
);

/** A bookmark's star: outlined until it is set, then filled with the current colour. */
export const StarIcon = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p}>
    <path
      d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Icon>
);

/** A screen with a play mark: the diagram shown, not edited. */
export const PresentIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M10 8.2v4.6l4-2.3z" fill="currentColor" stroke="none" />
    <path d="M8 20h8" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 018 0v3" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.8A10.6 10.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3.2 4M6.6 6.6C4 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.7 9.7 0 003.4-.6" />
    <path d="M9.9 9.9a3 3 0 004.2 4.2" />
  </Icon>
);

/** The same padlock with its shackle swung open. */
export const UnlockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 017.4-2.1" />
  </Icon>
);

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 19c.8-3.4 3.2-5.2 6.5-5.2s5.7 1.8 6.5 5.2" />
    <circle cx="17" cy="9" r="2.6" />
    <path d="M16 13.6c2.8.2 4.7 1.8 5.5 4.9" />
  </Icon>
);

export const MoreIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />
  </Icon>
);
