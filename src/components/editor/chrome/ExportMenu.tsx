'use client';

import type { MessageKey } from '@/lib/i18n/messages';
import {
  BracesIcon,
  ChevronDownIcon,
  DocumentIcon,
  DownloadIcon,
  FileTextIcon,
  GridIcon,
  ImageIcon,
  ListIcon,
  MeshIcon,
  MoonIcon,
  PrintIcon,
  SunIcon,
  VectorIcon,
} from '@/components/icons/ToolIcons';
import { useEditor } from '../EditorProvider';
import type { MenuProps } from './menuProps';
import { MenuGroup, MenuItem, MenuSeparator, TopBarMenu } from './TopBarMenu';

const EXPORT_THEME_KEY = {
  editor: 'export.themeEditor',
  light: 'export.themeLight',
  dark: 'export.themeDark',
} as const satisfies Record<string, MessageKey>;

/**
 * The Export menu: every image, document and code export, then the two
 * settings that shape them — the theme drawn on and whether metadata rides
 * along — which keep the menu open so the choice can be seen next to the
 * export it will apply to.
 */
export function ExportMenu({ menu, onToggle, onClose, pick, chord, off }: MenuProps) {
  const { ui, dispatchUi, t } = useEditor();
  return (
    <div className="topbar-menu-host">
      <button
        type="button"
        className="button"
        title={`${t('export.title')} · ${chord('exportMenu')}`}
        aria-label={t('export.title')}
        aria-haspopup="menu"
        aria-expanded={ui.menu === 'export'}
        onClick={() => onToggle()}
      >
        <DownloadIcon size={15} />
        <span className="button-label">{t('export.title')}</span>
        <ChevronDownIcon size={12} />
      </button>
      {menu.shown === 'export' && (
        <TopBarMenu
          label={t('export.title')}
          onClose={onClose}
          closing={menu.closing}
          onExited={menu.onExited}
        >
          <p className="topbar-menu-note">{t('export.subtitle')}</p>
          <MenuGroup label={t('export.image')} />
          <MenuItem
            icon={<ImageIcon size={15} />}
            label={t('export.png')}
            hint={t('export.pngHint')}
            onSelect={() => pick('exportPng')}
          />
          <MenuItem
            icon={<VectorIcon size={15} />}
            label={t('export.svg')}
            hint={t('export.svgHint')}
            onSelect={() => pick('exportSvg')}
          />
          <MenuItem
            icon={<PrintIcon size={15} />}
            label={t('export.pdf')}
            hint={t('export.pdfHint')}
            onSelect={() => pick('exportPdf')}
          />
          <MenuItem
            icon={<PrintIcon size={15} />}
            label={t('export.pdfViews')}
            hint={t('export.pdfViewsHint')}
            disabled={off('exportPdfViews')}
            onSelect={() => pick('exportPdfViews')}
          />
          <MenuItem
            icon={<MeshIcon size={15} />}
            label={t('export.drawio')}
            hint={t('export.drawioHint')}
            disabled={off('exportDrawio')}
            onSelect={() => pick('exportDrawio')}
          />
          <MenuSeparator />
          <MenuGroup label={t('export.document')} />
          <MenuItem
            icon={<FileTextIcon size={15} />}
            label={t('export.markdown')}
            hint={t('export.markdownHint')}
            onSelect={() => pick('exportMarkdown')}
          />
          <MenuItem
            icon={<DocumentIcon size={15} />}
            label={t('export.mermaid')}
            hint={t('export.mermaidHint')}
            onSelect={() => pick('exportMermaid')}
          />
          <MenuSeparator />
          <MenuGroup label={t('export.code')} />
          <MenuItem
            icon={<BracesIcon size={15} />}
            label={t('export.yaml')}
            hint={t('export.yamlHint')}
            onSelect={() => pick('exportYaml')}
          />
          <MenuItem
            icon={<BracesIcon size={15} />}
            label={t('export.json')}
            hint={t('export.jsonHint')}
            shortcut={chord('saveProject')}
            onSelect={() => pick('saveProject')}
          />
          <MenuSeparator />
          {/* Settings, not actions: the menu stays open so the effect of a
              choice can be seen next to the export it will apply to. */}
          <MenuGroup label={t('export.theme')} />
          {(['editor', 'light', 'dark'] as const).map((theme) => (
            <MenuItem
              key={theme}
              icon={
                theme === 'editor' ? (
                  <GridIcon size={15} />
                ) : theme === 'light' ? (
                  <SunIcon size={15} />
                ) : (
                  <MoonIcon size={15} />
                )
              }
              label={t(EXPORT_THEME_KEY[theme])}
              active={ui.exportTheme === theme}
              onSelect={() => dispatchUi({ type: 'setExportTheme', theme })}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            icon={<ListIcon size={15} />}
            label={t('export.meta')}
            hint={t('export.metaHint')}
            active={ui.exportMeta}
            onSelect={() => dispatchUi({ type: 'toggleExportMeta' })}
          />
        </TopBarMenu>
      )}
    </div>
  );
}
