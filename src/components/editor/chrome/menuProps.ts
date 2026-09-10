import type { Presence } from '@/lib/editor/usePresence';
import type { MenuKind } from '@/lib/editor/uiState';

/**
 * What the top bar hands each of its menus.
 *
 * `menu` is the presence of whichever menu is open — the one that is closing
 * stays for its exit — while the triggers report the real state from `ui.menu`.
 * `pick` runs a command and closes the menu; `chord` spells a shortcut; `off`
 * says whether a command is currently disabled.
 */
export interface MenuProps {
  menu: Presence<MenuKind>;
  onToggle: () => void;
  onClose: () => void;
  pick: (id: string) => void;
  chord: (id: string) => string | undefined;
  off: (id: string) => boolean;
}
