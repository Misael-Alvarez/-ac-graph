'use client';

import { useMemo } from 'react';
import {
  FINDING_HEADLINE,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  analyzeArchitecture,
  type Finding,
} from '@/lib/engine';
import { centerOn } from '@/lib/editor/viewport';
import { useEditor } from '../EditorProvider';
import { CloseIcon } from '@/components/icons/ToolIcons';
import { useReturnFocusToCanvas } from '@/lib/editor/returnFocus';

/**
 * What the diagram says about itself.
 *
 * The number at the top is never on its own: a score with no list under it is a
 * grade nobody can act on or argue with. Every row names the nodes it is about
 * and takes you to them.
 */
export function InsightsPanel({ size }: { size: { width: number; height: number } }) {
  useReturnFocusToCanvas();
  const { doc, ui, dispatchUi, t } = useEditor();

  const analysis = useMemo(() => analyzeArchitecture(doc.model), [doc.model]);

  const groups = useMemo(
    () =>
      SEVERITY_ORDER.map((severity) => ({
        severity,
        items: analysis.findings.filter((finding) => finding.severity === severity),
      })).filter((group) => group.items.length > 0),
    [analysis],
  );

  /** Selects what a finding is about and brings it into view. */
  const reveal = (finding: Finding) => {
    dispatchUi({ type: 'select', ids: finding.shapeIds });
    const shapes = doc.model.shapes.filter((s) => finding.shapeIds.includes(s.id));
    if (!shapes.length || !size.width) return;
    const x = shapes.reduce((sum, s) => sum + s.x + s.w / 2, 0) / shapes.length;
    const y = shapes.reduce((sum, s) => sum + s.y + s.h / 2, 0) / shapes.length;
    dispatchUi({ type: 'setViewport', viewport: centerOn(ui.viewport, { x, y }, size) });
  };

  return (
    <aside className="side-panel" aria-label={t('insight.title')}>
      <header className="code-panel-header">
        <strong className="side-panel-title">{t('insight.title')}</strong>
        <span className="code-panel-spacer" />
        <span className="result-count">
          {t('insight.counted', { nodes: analysis.nodes, edges: analysis.edges })}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('modal.close')}
          onClick={() => dispatchUi({ type: 'toggleInsights' })}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      {/* The score, and immediately under it everything it is made of. There is
          no score for an empty diagram: a green 100 over nothing at all is the
          most misleading number the panel could show. */}
      {analysis.nodes > 0 && (
        <div className={`insight-score is-${scoreBand(analysis.score)}`}>
          <b className="tabular">{analysis.score}</b>
          <span>{t('insight.score')}</span>
        </div>
      )}

      <div className="insight-list">
        {analysis.nodes === 0 && <p className="library-note">{t('insight.empty')}</p>}

        {analysis.nodes > 0 && groups.length === 0 && (
          <p className="library-note">{t('insight.clean')}</p>
        )}

        {groups.map((group) => (
          <section key={group.severity} className="insight-group">
            <header className={`group-header is-${group.severity}`}>
              {t(SEVERITY_LABEL[group.severity])}
              <span className="group-count">{group.items.length}</span>
            </header>
            {group.items.map((finding) => (
              <button
                key={finding.id}
                type="button"
                className="insight-row"
                onClick={() => reveal(finding)}
              >
                <span className={`insight-dot is-${finding.severity}`} aria-hidden="true" />
                <span className="insight-text">
                  {t(FINDING_HEADLINE[finding.kind], finding.detail)}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>

      <footer className="panel-footer">{t('insight.footer')}</footer>
    </aside>
  );
}

/** Three bands, so the number is coloured by what it means rather than by taste. */
function scoreBand(score: number): 'good' | 'fair' | 'poor' {
  if (score >= 85) return 'good';
  return score >= 60 ? 'fair' : 'poor';
}
