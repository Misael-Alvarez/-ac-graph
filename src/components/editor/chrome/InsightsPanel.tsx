'use client';

import { useMemo } from 'react';
import {
  FINDING_HEADLINE,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  analyzeArchitecture,
} from '@/lib/engine';
import { centerOn } from '@/lib/editor/viewport';
import { checkRules } from '@/lib/rules';
import { useEditor } from '../EditorProvider';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { PanelHead } from '@/components/ui/PanelHead';
import { Row } from '@/components/ui/Row';
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

  // The standards this architecture declares, checked against it. A rule is the
  // team's own sentence, so unlike a finding it is shown rather than translated.
  const rules = useMemo(
    () => checkRules(doc.model, { version: 1, rules: doc.model.rules ?? [] }),
    [doc.model],
  );

  const groups = useMemo(
    () =>
      SEVERITY_ORDER.map((severity) => ({
        severity,
        items: analysis.findings.filter((finding) => finding.severity === severity),
      })).filter((group) => group.items.length > 0),
    [analysis],
  );

  /** Selects what a row is about and brings it into view. */
  const reveal = (target: { shapeIds: string[] }) => {
    dispatchUi({ type: 'select', ids: target.shapeIds });
    const shapes = doc.model.shapes.filter((s) => target.shapeIds.includes(s.id));
    if (!shapes.length || !size.width) return;
    const x = shapes.reduce((sum, s) => sum + s.x + s.w / 2, 0) / shapes.length;
    const y = shapes.reduce((sum, s) => sum + s.y + s.h / 2, 0) / shapes.length;
    dispatchUi({ type: 'setViewport', viewport: centerOn(ui.viewport, { x, y }, size) });
  };

  return (
    <aside className="side-panel" aria-label={t('insight.title')}>
      <PanelHead
        title={t('insight.title')}
        count={t('insight.counted', { nodes: analysis.nodes, edges: analysis.edges })}
        closeLabel={t('modal.close')}
        onClose={() => dispatchUi({ type: 'toggleInsights' })}
      />

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

        {analysis.nodes > 0 && groups.length === 0 && rules.violations.length === 0 && (
          <p className="library-note">{t('insight.clean')}</p>
        )}

        {/* Above the findings: a broken standard is a rule somebody wrote down,
            and an observation is one nobody has decided about yet. */}
        {rules.violations.length > 0 && (
          <section className="insight-group">
            {/* The badge carries the count; repeating it in the label reads
                like a stutter. The CLI, which has no badge, says it in words. */}
            <GroupHeader as="header" modifier="is-high" count={rules.violations.length}>
              {t('rules.broken')}
            </GroupHeader>
            {rules.violations.map((violation) => (
              <Row
                key={`${violation.ruleId}:${violation.subject}`}
                className="insight-row"
                onClick={() => reveal(violation)}
                icon={
                  <span className={`insight-dot is-${violation.severity}`} aria-hidden="true" />
                }
              >
                <span className="insight-text">
                  <b>
                    {violation.subject}
                    {violation.field ? ` — ${violation.field}` : ''}
                  </b>
                  <small className="insight-rule">{violation.description}</small>
                </span>
              </Row>
            ))}
          </section>
        )}

        {groups.map((group) => (
          <section key={group.severity} className="insight-group">
            <GroupHeader as="header" modifier={`is-${group.severity}`} count={group.items.length}>
              {t(SEVERITY_LABEL[group.severity])}
            </GroupHeader>
            {group.items.map((finding) => (
              <Row
                key={finding.id}
                className="insight-row"
                onClick={() => reveal(finding)}
                icon={<span className={`insight-dot is-${finding.severity}`} aria-hidden="true" />}
              >
                <span className="insight-text">
                  {t(FINDING_HEADLINE[finding.kind], finding.detail)}
                </span>
              </Row>
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
