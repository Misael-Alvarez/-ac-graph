'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diffModels, type ChangeKind } from '@/lib/engine';
import type { DiagramModel, DiagramRecord, DiagramVersion } from '@/lib/domain';
import { useParams } from 'next/navigation';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';
import { renderThumbnail } from '@/lib/store/thumbnail';
import { useRepository } from '@/components/app/RepositoryProvider';
import { useEditor } from '../EditorProvider';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { PanelHead } from '@/components/ui/PanelHead';
import { useReturnFocusToCanvas } from '@/lib/editor/returnFocus';
import { relativeDay } from '@/lib/i18n/relativeDay';
import { MAX_VERSIONS_PER_DIAGRAM } from '@/lib/store/localRepository';

/** The sign each kind of change wears, the way a diff has always written it. */
const MARK: Record<ChangeKind, string> = { added: '+', removed: '−', changed: '~' };

interface VersionPanelProps {
  onSnapshot: (model: DiagramModel) => Promise<void>;
  onRestore: (versionId: string, model: DiagramModel) => Promise<DiagramRecord>;
  revision: string;
}

/**
 * The version timeline.
 *
 * Restoring goes through the repository, which snapshots the current state first
 * — so restoring is itself undoable — and then the editor is reloaded from what
 * was written, rather than the panel guessing at the new state.
 */
export function VersionPanel({ onSnapshot, onRestore, revision }: VersionPanelProps) {
  useReturnFocusToCanvas();
  const repository = useRepository();
  const { doc, dispatch, dispatchUi, readOnly, t } = useEditor();
  const params = useParams<{ id: string }>();
  const diagramId = params?.id ?? '';

  const [versions, setVersions] = useState<DiagramVersion[]>([]);
  const [comparing, setComparing] = useState<DiagramVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef({ sequence: 0 });

  const refresh = useCallback(() => {
    if (!diagramId) return Promise.resolve();
    const requests = request.current;
    const reading = ++requests.sequence;
    return repository.listVersions(diagramId).then(
      (found) => {
        if (reading !== requests.sequence) return;
        setVersions(found);
        setLoading(false);
      },
      () => {
        if (reading !== requests.sequence) return;
        setError(true);
        setLoading(false);
      },
    );
  }, [repository, diagramId]);

  // Refresh after a confirmed commit, not before the autosave debounce fires.
  useEffect(() => {
    const requests = request.current;
    void refresh();
    return () => {
      requests.sequence++;
    };
  }, [refresh, revision]);

  // Thumbnails are re-rendered SVGs, and a stored version's never changes. Kept
  // out of the render path: this panel re-renders on every edit, and redrawing
  // twenty previews per keystroke is felt as lag in the canvas, not here.
  // The previews are of the diagram, which is paper — so they are paper too,
  // whatever the panel around them is doing.
  const currentThumb = useMemo(() => thumbnailDataUrl(renderThumbnail(doc.model)), [doc.model]);
  const thumbs = useMemo(
    () => new Map(versions.map((v) => [v.id, thumbnailDataUrl(renderThumbnail(v.model))])),
    [versions],
  );

  /**
   * Snapshots under the day they were taken.
   *
   * A flat column of times is unreadable past the first screen: the question a
   * reader has is "where was I yesterday", and the answer has to be a heading
   * rather than arithmetic on a timestamp. The list arrives newest first, so
   * consecutive runs are all the grouping needs.
   */
  const groups = useMemo(() => {
    const out: { label: string; items: DiagramVersion[] }[] = [];
    for (const version of versions) {
      const label = relativeDay(version.createdAt, t);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(version);
      else out.push({ label, items: [version] });
    }
    return out;
  }, [versions, t]);

  /**
   * What changed between a snapshot and where the diagram is now.
   *
   * Recomputed whenever either side moves, so the list stays true while you
   * keep editing with the comparison open.
   */
  const diff = useMemo(
    () => (comparing ? diffModels(comparing.model, doc.model) : null),
    [comparing, doc.model],
  );

  // The canvas paints what the list is talking about. Cleared on the way out,
  // including when the panel closes with a comparison still open.
  useEffect(() => {
    dispatchUi({
      type: 'setDiffHighlight',
      highlight: diff
        ? {
            added: diff.nodes.filter((n) => n.kind === 'added').map((n) => n.shape.id),
            changed: diff.nodes.filter((n) => n.kind === 'changed').map((n) => n.shape.id),
          }
        : null,
    });
  }, [diff, dispatchUi]);

  useEffect(() => () => dispatchUi({ type: 'setDiffHighlight', highlight: null }), [dispatchUi]);

  const restore = async (version: DiagramVersion) => {
    setBusy(true);
    setError(false);
    try {
      const restored = await onRestore(version.id, doc.model);
      // Replace rather than load, so the user can undo the restore in the editor.
      dispatch({ type: 'replaceModel', model: restored.model });
      dispatchUi({ type: 'clearSelection' });
      setComparing(null);
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const snapshot = async () => {
    setBusy(true);
    setError(false);
    try {
      await onSnapshot(doc.model);
      dispatchUi({ type: 'toast', message: t('versions.saved') });
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="side-panel" aria-label={t('versions.title')}>
      <PanelHead
        title={t('versions.title')}
        actions={
          readOnly ? undefined : (
            <button
              type="button"
              className="button is-small"
              disabled={busy}
              onClick={() => void snapshot()}
            >
              {t('versions.snapshot')}
            </button>
          )
        }
        closeLabel={t('modal.close')}
        onClose={() => dispatchUi({ type: 'toggleVersions' })}
      />

      {error && (
        <p className="library-note" role="alert">
          {t('versions.failed')}
        </p>
      )}

      {diff && comparing && (
        <div className="version-list">
          <GroupHeader
            as="header"
            count={new Date(comparing.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          >
            {t('versions.comparing')}
          </GroupHeader>

          {diff.identical && <p className="library-note">{t('diff.identical')}</p>}

          {diff.nodes.length > 0 && (
            <section>
              <GroupHeader as="header" count={diff.nodes.length}>
                {t('diff.nodes')}
              </GroupHeader>
              {diff.nodes.map((change) => (
                <p
                  key={`${change.kind}-${change.shape.id}`}
                  className={`diff-row is-${change.kind}`}
                >
                  <span className="diff-mark" aria-hidden="true">
                    {MARK[change.kind]}
                  </span>
                  <span>
                    {change.shape.title || change.shape.icon?.key}
                    {change.fields.length > 0 && <small> · {change.fields.join(', ')}</small>}
                  </span>
                </p>
              ))}
            </section>
          )}

          {diff.edges.length > 0 && (
            <section>
              <GroupHeader as="header" count={diff.edges.length}>
                {t('diff.edges')}
              </GroupHeader>
              {diff.edges.map((change) => (
                <p
                  key={`${change.kind}-${change.connector.id}`}
                  className={`diff-row is-${change.kind}`}
                >
                  <span className="diff-mark" aria-hidden="true">
                    {MARK[change.kind]}
                  </span>
                  <span>
                    {change.from} → {change.to}
                    {change.fields.length > 0 && <small> · {change.fields.join(', ')}</small>}
                  </span>
                </p>
              ))}
            </section>
          )}

          <div className="version-compare-exit">
            <button type="button" className="button is-small" onClick={() => setComparing(null)}>
              {t('versions.exitCompare')}
            </button>
          </div>
        </div>
      )}

      {!comparing && (
        <div className="version-list">
          <article className="version-row is-current">
            <span className="version-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
              <img src={currentThumb} alt="" />
            </span>
            <span className="version-meta">
              <b>{t('versions.current')}</b>
              <small>
                {t('status.shapes', { count: doc.model.shapes.length })} ·{' '}
                {t('status.connectors', { count: doc.model.connectors.length })}
              </small>
            </span>
          </article>

          {loading && <p className="library-note">{t('library.loading')}</p>}
          {!loading && versions.length === 0 && (
            <p className="library-note">{t('versions.empty')}</p>
          )}

          {groups.map((group) => (
            <section key={group.label} className="version-group">
              <GroupHeader as="header" count={group.items.length}>
                {group.label}
              </GroupHeader>
              {group.items.map((version) => (
                <article key={version.id} className="version-row">
                  <span className="version-thumb">
                    {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
                    <img src={thumbs.get(version.id)} alt="" />
                  </span>
                  <span className="version-meta">
                    <b>
                      {new Date(version.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </b>
                    {version.label && <small>{version.label}</small>}
                  </span>
                  <button
                    type="button"
                    className="button is-small"
                    onClick={() => setComparing(version)}
                  >
                    {t('versions.compare')}
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      className="button is-small"
                      disabled={busy}
                      onClick={() => void restore(version)}
                    >
                      {t('versions.restore')}
                    </button>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}

      {/* The store keeps a bounded history. Saying so is the difference between
          a timeline that ends and one that looks like it lost something. */}
      {!comparing && versions.length > 0 && (
        <footer className="panel-footer">
          {t('versions.kept', { count: MAX_VERSIONS_PER_DIAGRAM })}
        </footer>
      )}
    </aside>
  );
}
