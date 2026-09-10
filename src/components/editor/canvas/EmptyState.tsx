'use client';

import { AcMark } from '@/components/brand/AcGraphLogo';
import { useEditor } from '../EditorProvider';
import { ImportIcon, SearchIcon, TemplateIcon } from '@/components/icons/ToolIcons';
import { shortcut } from '@/lib/editor/platform';
import { Kbd } from '@/components/ui/Kbd';

/** Shown on a blank canvas: three ways to start, each one clickable. */
export function EmptyState() {
  const { ui, dispatchUi, t } = useEditor();
  // These three cards are wide enough to cover the middle of the canvas, which
  // is exactly where someone reaches to drop their first shape. Once a drawing
  // tool is armed the choice has already been made, so the cards step back to
  // being a picture and let the click through to the canvas underneath.
  const drawing = ui.tool !== 'select';

  return (
    <div className={`empty-state${drawing ? ' is-drawing' : ''}`}>
      <AcMark size={40} animate className="empty-state-mark" />
      <h2 className="empty-state-title">{t('canvas.empty.title')}</h2>
      <p className="empty-state-subtitle">{t('canvas.empty.subtitle')}</p>
      <div className="empty-state-actions">
        <button
          type="button"
          className="empty-state-action"
          onClick={() => dispatchUi({ type: 'setPaletteOpen', open: true })}
        >
          <span className="empty-state-icon">
            <SearchIcon size={17} />
          </span>
          {t('canvas.empty.search')}
          <small>{t('canvas.empty.searchHint')}</small>
          <Kbd>{shortcut('K')}</Kbd>
        </button>
        <button
          type="button"
          className="empty-state-action"
          onClick={() => dispatchUi({ type: 'setModal', modal: 'templates' })}
        >
          <span className="empty-state-icon">
            <TemplateIcon size={17} />
          </span>
          {t('canvas.empty.template')}
          <small>{t('canvas.empty.templateHint')}</small>
        </button>
        <button
          type="button"
          className="empty-state-action"
          onClick={() => dispatchUi({ type: 'setModal', modal: 'markdown' })}
        >
          <span className="empty-state-icon">
            <ImportIcon size={17} />
          </span>
          {t('canvas.empty.import')}
          <small>{t('canvas.empty.importHint')}</small>
        </button>
      </div>
    </div>
  );
}
