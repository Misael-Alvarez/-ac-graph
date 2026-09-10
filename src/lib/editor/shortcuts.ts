import type { MessageKey } from '@/lib/i18n/messages';

/**
 * The keyboard, declared once.
 *
 * Every binding lives here and only here. `useKeyboard` reads this table to
 * decide what a keystroke means, `useCommands` reads it to print the hint next
 * to each command, and the shortcut sheet reads it to describe itself — so a
 * key can no longer be advertised without being handled, or handled without
 * being advertised, which is how `Space` came to be labelled "fit to view"
 * while it panned.
 *
 * `Mod` is the platform modifier and is spelled per platform at render time.
 * Letters are lower-case and matched against `event.key.toLowerCase()`.
 */
export interface Shortcut {
  /** The command this fires, by id from `useCommands`, or a tool by name. */
  id: string;
  /** Human-readable chord, e.g. `Mod+Shift+S`, `V`, `Del`, `Arrows`. */
  keys: string;
  /** What the sheet says it does. */
  labelKey: MessageKey;
  /**
   * `global` shortcuts fire even inside a text field and while a dialog is
   * open — panel toggles and the palette. `canvas` shortcuts fire only when the
   * canvas has the keyboard. `tool` shortcuts are the single-letter tool picks.
   */
  scope: 'global' | 'canvas' | 'tool';
}

export interface ShortcutGroup {
  titleKey: MessageKey;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'shortcuts.tools',
    items: [
      { id: 'select', keys: 'V', labelKey: 'tool.select', scope: 'tool' },
      { id: 'boundary', keys: 'B', labelKey: 'tool.boundary', scope: 'tool' },
      { id: 'subboundary', keys: 'U', labelKey: 'tool.subboundary', scope: 'tool' },
      { id: 'group', keys: 'G', labelKey: 'tool.group', scope: 'tool' },
      { id: 'item', keys: 'I', labelKey: 'tool.item', scope: 'tool' },
      { id: 'connector', keys: 'C', labelKey: 'tool.connector', scope: 'tool' },
      { id: 'pan', keys: 'H', labelKey: 'tool.pan', scope: 'tool' },
      { id: 'panHold', keys: 'Space', labelKey: 'shortcuts.panHold', scope: 'canvas' },
    ],
  },
  {
    titleKey: 'shortcuts.edit',
    items: [
      { id: 'undo', keys: 'Mod+Z', labelKey: 'action.undo', scope: 'canvas' },
      { id: 'redo', keys: 'Mod+Shift+Z', labelKey: 'action.redo', scope: 'canvas' },
      { id: 'selectAll', keys: 'Mod+A', labelKey: 'action.selectAll', scope: 'canvas' },
      { id: 'deselect', keys: 'Mod+Shift+A', labelKey: 'action.deselect', scope: 'canvas' },
      { id: 'duplicate', keys: 'Mod+D', labelKey: 'action.duplicate', scope: 'canvas' },
      { id: 'copy', keys: 'Mod+C', labelKey: 'action.copy', scope: 'canvas' },
      { id: 'paste', keys: 'Mod+V', labelKey: 'action.paste', scope: 'canvas' },
      { id: 'delete', keys: 'Del', labelKey: 'action.delete', scope: 'canvas' },
      { id: 'nudge', keys: 'Arrows', labelKey: 'shortcuts.nudge', scope: 'canvas' },
      { id: 'nudgeStep', keys: 'Shift+Arrows', labelKey: 'shortcuts.nudgeStep', scope: 'canvas' },
      { id: 'autoLayout', keys: 'Mod+Shift+L', labelKey: 'action.autoLayout', scope: 'canvas' },
    ],
  },
  {
    titleKey: 'shortcuts.view',
    items: [
      { id: 'zoomFit', keys: 'Mod+1', labelKey: 'action.zoomFit', scope: 'canvas' },
      { id: 'zoomReset', keys: 'Mod+0', labelKey: 'action.zoomReset', scope: 'canvas' },
      { id: 'toggleGrid', keys: "Mod+'", labelKey: 'action.toggleGrid', scope: 'canvas' },
      { id: 'toggleMinimap', keys: 'Mod+M', labelKey: 'action.toggleMinimap', scope: 'canvas' },
      { id: 'toggleTheme', keys: 'Mod+Shift+D', labelKey: 'action.toggleTheme', scope: 'canvas' },
      { id: 'insights', keys: 'Mod+I', labelKey: 'action.insights', scope: 'global' },
      { id: 'toggleVersions', keys: 'Mod+H', labelKey: 'versions.title', scope: 'global' },
      { id: 'toggleCode', keys: 'Mod+/', labelKey: 'action.toggleCode', scope: 'global' },
      { id: 'toggleBrowser', keys: 'Mod+B', labelKey: 'action.browser', scope: 'global' },
    ],
  },
  {
    titleKey: 'shortcuts.file',
    items: [
      { id: 'palette', keys: 'Mod+K', labelKey: 'palette.placeholder', scope: 'global' },
      { id: 'find', keys: 'Mod+F', labelKey: 'action.find', scope: 'global' },
      { id: 'ai', keys: 'Mod+J', labelKey: 'action.ai', scope: 'global' },
      { id: 'exportMenu', keys: 'Mod+E', labelKey: 'export.title', scope: 'global' },
      { id: 'saveProject', keys: 'Mod+S', labelKey: 'action.save', scope: 'global' },
      { id: 'share', keys: 'Mod+Shift+S', labelKey: 'action.share', scope: 'global' },
      { id: 'shortcuts', keys: '?', labelKey: 'action.shortcuts', scope: 'canvas' },
      { id: 'escape', keys: 'Esc', labelKey: 'shortcuts.escape', scope: 'global' },
    ],
  },
];

/** Every binding, flat. */
export const SHORTCUTS: Shortcut[] = SHORTCUT_GROUPS.flatMap((g) => g.items);

/** The chord for a command id, or undefined when it has none. */
export function shortcutFor(id: string): string | undefined {
  return SHORTCUTS.find((s) => s.id === id)?.keys;
}

/**
 * Normalises a keyboard event into the chord notation used above.
 *
 * Returns null for keys that are never bindings on their own (a bare modifier,
 * an unknown key). `Mod` is either Ctrl or Meta; the other modifier is ignored
 * so `Ctrl+Shift+Z` and `Cmd+Shift+Z` both read `Mod+Shift+Z`.
 */
export function chordOf(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  const key = event.key;
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return null;

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey && key.length > 1) parts.push('Shift');
  // A shifted letter arrives upper-case; a shifted symbol arrives as the
  // symbol itself, so Shift is only spelled for non-character keys and letters.
  if (event.shiftKey && key.length === 1 && /[a-z]/i.test(key)) parts.push('Shift');

  const NAMES: Record<string, string> = {
    ' ': 'Space',
    Escape: 'Esc',
    Delete: 'Del',
    Backspace: 'Del',
    ArrowLeft: 'Arrows',
    ArrowRight: 'Arrows',
    ArrowUp: 'Arrows',
    ArrowDown: 'Arrows',
  };
  const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  parts.push(name);
  return parts.join('+');
}

/** Looks up the binding a chord fires, if any. */
export function bindingFor(chord: string): Shortcut | undefined {
  return SHORTCUTS.find((s) => s.keys === chord);
}

/** Bindings must be unique: two commands on one chord is a bug, not a feature. */
export function duplicateChords(): string[] {
  const seen = new Map<string, number>();
  for (const s of SHORTCUTS) seen.set(s.keys, (seen.get(s.keys) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
