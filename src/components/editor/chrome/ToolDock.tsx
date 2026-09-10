'use client';

import type { ToolMode } from '@/lib/editor';
import { shortcut } from '@/lib/editor/platform';
import type { MessageKey } from '@/lib/i18n/messages';
import { useEditor } from '../EditorProvider';
import {
  LayoutIcon,
  BoundaryIcon,
  ConnectorIcon,
  GroupIcon,
  ItemIcon,
  SelectIcon,
  SubBoundaryIcon,
} from '@/components/icons/ToolIcons';

interface ToolDefinition {
  mode: ToolMode;
  labelKey: MessageKey;
  shortcut: string;
  Icon: (props: { size?: number }) => React.ReactElement;
}

export const TOOLS: ToolDefinition[] = [
  { mode: 'select', labelKey: 'tool.select', shortcut: 'V', Icon: SelectIcon },
  { mode: 'boundary', labelKey: 'tool.boundary', shortcut: 'B', Icon: BoundaryIcon },
  { mode: 'subboundary', labelKey: 'tool.subboundary', shortcut: 'U', Icon: SubBoundaryIcon },
  { mode: 'group', labelKey: 'tool.group', shortcut: 'G', Icon: GroupIcon },
  { mode: 'item', labelKey: 'tool.item', shortcut: 'I', Icon: ItemIcon },
  { mode: 'connector', labelKey: 'tool.connector', shortcut: 'C', Icon: ConnectorIcon },
];

/** Floating vertical tool dock. */
export function ToolDock() {
  const { ui, dispatchUi, t } = useEditor();
  const activeIndex = TOOLS.findIndex((tool) => tool.mode === ui.tool);

  return (
    <div
      className="tool-dock"
      data-tooltip-side="right"

      role="toolbar"
      aria-orientation="vertical"
      aria-label={t('app.title')}
      /* One pill slides between the tools instead of each one lighting up on
         its own: the eye follows a thing that moves, and loses one that blinks
         out here and in over there. `pan` has no button of its own, so the
         pill steps aside rather than parking on the wrong tool. */
      data-armed={activeIndex >= 0}
      style={{ '--tool-index': Math.max(activeIndex, 0) } as React.CSSProperties}
    >
      <button
        type="button"
        data-tool="browser"
        className={`tool-button${ui.browserOpen ? ' is-active' : ''}`}
        aria-pressed={ui.browserOpen}
        aria-label={t('action.browser')}
        onClick={() => dispatchUi({ type: 'toggleBrowser' })}
      >
        <LayoutIcon size={18} />
        {/* The tooltip is the visible label, and naming the button with it as
            well made every one of them announce its own shortcut twice. */}
        <span className="tool-tooltip" role="tooltip" aria-hidden="true">
          {t('action.browser')}
          <kbd>{shortcut('B')}</kbd>
        </span>
      </button>
      <span className="tool-dock-divider" />
      {TOOLS.map(({ mode, labelKey, shortcut, Icon }) => {
        const active = ui.tool === mode;
        return (
          <button
            key={mode}
            type="button"
            data-tool={mode}
            className={`tool-button${active ? ' is-active' : ''}`}
            aria-pressed={active}
            aria-keyshortcuts={shortcut}
            aria-label={t(labelKey)}
            onClick={() => dispatchUi({ type: 'setTool', tool: mode })}
          >
            <Icon size={18} />
            <span className="tool-tooltip" role="tooltip" aria-hidden="true">
              {t(labelKey)}
              <kbd>{shortcut}</kbd>
            </span>
          </button>
        );
      })}
    </div>
  );
}
