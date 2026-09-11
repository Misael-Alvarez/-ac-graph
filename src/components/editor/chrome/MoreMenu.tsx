'use client';

import {
  CloudIcon,
  EraseIcon,
  FolderIcon,
  ImportIcon,
  KeyboardIcon,
  MapIcon,
  MoreIcon,
  PresentIcon,
  SaveIcon,
  TemplateIcon,
  ZoomOutIcon,
} from '@/components/icons/ToolIcons';
import { useEditor } from '../EditorProvider';
import type { MenuProps } from './menuProps';
import { MenuGroup, MenuItem, MenuSeparator, TopBarMenu } from './TopBarMenu';

/** Everything done once a week lives one click away, not in a search. */
export function MoreMenu({ menu, onToggle, onClose, pick, chord, off }: MenuProps) {
  const { ui, t } = useEditor();
  return (
    <div className="topbar-menu-host">
      <button
        type="button"
        className="icon-button"
        title={t('topbar.more')}
        aria-label={t('topbar.more')}
        aria-haspopup="menu"
        aria-expanded={ui.menu === 'more'}
        onClick={() => onToggle()}
      >
        <MoreIcon size={16} />
      </button>
      {menu.shown === 'more' && (
        <TopBarMenu
          label={t('topbar.more')}
          onClose={onClose}
          closing={menu.closing}
          onExited={menu.onExited}
        >
          <MenuGroup label={t('topbar.document')} />
          <MenuItem
            icon={<TemplateIcon size={15} />}
            label={t('action.templates')}
            disabled={off('templates')}
            onSelect={() => pick('templates')}
          />
          <MenuItem
            icon={<SaveIcon size={15} />}
            label={t('action.saveAsTemplate')}
            hint={t('action.saveAsTemplateHint')}
            disabled={off('saveAsTemplate')}
            onSelect={() => pick('saveAsTemplate')}
          />
          <MenuItem
            icon={<CloudIcon size={15} />}
            label={t('action.switchCloud')}
            disabled={off('switchCloud')}
            onSelect={() => pick('switchCloud')}
          />
          <MenuItem
            icon={<ImportIcon size={15} />}
            label={t('action.importMarkdown')}
            disabled={off('importMarkdown')}
            onSelect={() => pick('importMarkdown')}
          />
          <MenuItem
            icon={<FolderIcon size={15} />}
            label={t('action.open')}
            disabled={off('openProject')}
            onSelect={() => pick('openProject')}
          />
          <MenuItem
            icon={<SaveIcon size={15} />}
            label={t('action.save')}
            shortcut={chord('saveProject')}
            onSelect={() => pick('saveProject')}
          />
          <MenuSeparator />
          <MenuGroup label={t('topbar.canvas')} />
          <MenuItem
            icon={<ZoomOutIcon size={15} />}
            label={t('action.zoomReset')}
            shortcut={chord('zoomReset')}
            onSelect={() => pick('zoomReset')}
          />
          <MenuItem
            icon={<MapIcon size={15} />}
            label={t('action.toggleMinimap')}
            shortcut={chord('toggleMinimap')}
            active={ui.minimapOpen}
            onSelect={() => pick('toggleMinimap')}
          />
          <MenuItem
            icon={<PresentIcon size={15} />}
            label={t('action.present')}
            shortcut={chord('present')}
            onSelect={() => pick('present')}
          />
          <MenuItem
            icon={<ImportIcon size={15} />}
            label={t('action.icons')}
            hint={t('icons.uploadHint')}
            disabled={off('icons')}
            onSelect={() => pick('icons')}
          />
          <MenuItem
            icon={<KeyboardIcon size={15} />}
            label={t('action.shortcuts')}
            shortcut={chord('shortcuts')}
            onSelect={() => pick('shortcuts')}
          />
          <MenuSeparator />
          <MenuItem
            icon={<EraseIcon size={15} />}
            label={t('action.clear')}
            danger
            disabled={off('clear')}
            onSelect={() => pick('clear')}
          />
        </TopBarMenu>
      )}
    </div>
  );
}
