'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommentAnchor, CommentThread } from '@/lib/domain';
import { getShape } from '@/lib/engine';
import { colorForUser } from '@/lib/collab/colors';
import { relativeDay } from '@/lib/i18n/relativeDay';
import { centerOn } from '@/lib/editor/viewport';
import { useReturnFocusToCanvas } from '@/lib/editor/returnFocus';
import { useUser } from '@/components/app/AuthProvider';
import { CloseIcon, TrashIcon } from '@/components/icons/ToolIcons';
import { GroupHeader } from '@/components/ui/GroupHeader';
import { PanelHead } from '@/components/ui/PanelHead';
import { useEditor } from '../EditorProvider';
import { useComments } from './CommentsProvider';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Translate = ReturnType<typeof useEditor>['t'];

/** "today 14:02", "yesterday 09:30", or the date for anything older. */
function when(iso: string, t: Translate): string {
  const day = relativeDay(iso, t);
  const time = new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

/**
 * The conversations on the diagram, and a place to start one.
 *
 * The composer at the top writes where the reader said — the shape they
 * right-clicked, the point on the sheet, or failing those the shape they have
 * selected — and says so before they type. Below it the open threads, oldest
 * first, then the resolved ones folded away; each thread is where it is
 * about, who said what and when, a reply box, and the two things one can do
 * to a thread: settle it, or take it back.
 */
export function CommentsPanel({ size }: { size: { width: number; height: number } }) {
  useReturnFocusToCanvas();
  const { doc, ui, view, dispatchUi, t } = useEditor();
  const { user } = useUser();
  const comments = useComments();
  const [showResolved, setShowResolved] = useState(false);

  // Where the next comment goes: what the menu chose, else the one selected shape.
  const selected = ui.selectedIds.size === 1 ? [...ui.selectedIds][0] : null;
  const target: CommentAnchor | null = useMemo(() => {
    if (ui.commentDraft) return ui.commentDraft;
    if (!selected) return null;
    const shape = getShape(doc.model, selected);
    return shape ? { shapeId: shape.id, x: shape.x + shape.w, y: shape.y } : null;
  }, [ui.commentDraft, selected, doc.model]);

  const anchorLabel = (anchor: CommentAnchor): string => {
    if (!anchor.shapeId) return t('comments.onSheet');
    const shape = getShape(doc.model, anchor.shapeId);
    if (!shape) return `${t('comments.onSheet')} · ${t('comments.shapeGone')}`;
    return t('comments.onShape', { title: shape.title || shape.type });
  };

  const open = comments.open;
  const resolved = useMemo(
    () => comments.threads.filter((thread) => thread.resolvedAt !== null),
    [comments.threads],
  );

  /** Selects what a thread is about and brings it into view. */
  const reveal = (thread: CommentThread) => {
    const shape = thread.anchor.shapeId ? getShape(view, thread.anchor.shapeId) : undefined;
    if (shape) dispatchUi({ type: 'select', ids: [shape.id] });
    const point = shape
      ? { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 }
      : { x: thread.anchor.x, y: thread.anchor.y };
    if (size.width)
      dispatchUi({ type: 'setViewport', viewport: centerOn(ui.viewport, point, size) });
  };

  // A pin was pressed: the thread it names comes into view and lights up —
  // unfolding the resolved ones if that is where it went.
  const focused = comments.threads.find((thread) => thread.id === ui.commentFocus);
  const resolvedShown = showResolved || Boolean(focused?.resolvedAt);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ui.commentFocus) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thread-id="${ui.commentFocus}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [ui.commentFocus, comments.threads]);

  return (
    <aside className="side-panel" aria-label={t('comments.title')}>
      <PanelHead
        title={t('comments.title')}
        count={open.length || undefined}
        closeLabel={t('modal.close')}
        onClose={() => dispatchUi({ type: 'toggleComments' })}
      />

      <Composer
        key={target ? `${target.shapeId ?? 'sheet'}:${target.x}:${target.y}` : 'none'}
        target={target}
        label={target ? anchorLabel(target) : null}
        chosen={ui.commentDraft !== null}
        onClear={() => dispatchUi({ type: 'setCommentDraft', anchor: null })}
        onSend={async (body) => {
          if (!target) return false;
          const thread = await comments.create(target, body);
          if (!thread) return false;
          dispatchUi({ type: 'setCommentDraft', anchor: null });
          dispatchUi({ type: 'setCommentFocus', threadId: thread.id });
          return true;
        }}
        t={t}
      />

      {comments.failed && (
        <p className="library-note" role="alert">
          {t('comments.failed')}
        </p>
      )}

      <div className="version-list comments-list" ref={listRef}>
        {!comments.loading && comments.threads.length === 0 && (
          <p className="library-note">{t('comments.empty')}</p>
        )}

        {open.length > 0 && (
          <section className="comment-group">
            <GroupHeader as="header" count={open.length}>
              {t('comments.open')}
            </GroupHeader>
            {open.map((thread) => (
              <Thread
                key={thread.id}
                thread={thread}
                focused={thread.id === ui.commentFocus}
                label={anchorLabel(thread.anchor)}
                selfId={user.id}
                canModerate={comments.canModerate}
                onReveal={() => reveal(thread)}
                onReply={(body) => comments.reply(thread.id, body)}
                onResolve={() => void comments.setResolved(thread.id, true)}
                onDelete={() => void comments.remove(thread.id)}
                t={t}
              />
            ))}
          </section>
        )}

        {resolved.length > 0 && (
          <section className="comment-group">
            <GroupHeader
              as="button"
              count={resolved.length}
              open={resolvedShown}
              onToggle={() => {
                setShowResolved(!resolvedShown);
                // Folding the resolved ones away lets go of the one a pin pointed at.
                if (resolvedShown) dispatchUi({ type: 'setCommentFocus', threadId: null });
              }}
            >
              {t('comments.resolved')}
            </GroupHeader>
            {resolvedShown &&
              resolved.map((thread) => (
                <Thread
                  key={thread.id}
                  thread={thread}
                  focused={thread.id === ui.commentFocus}
                  label={anchorLabel(thread.anchor)}
                  selfId={user.id}
                  canModerate={comments.canModerate}
                  onReveal={() => reveal(thread)}
                  onReply={(body) => comments.reply(thread.id, body)}
                  onResolve={() => void comments.setResolved(thread.id, false)}
                  onDelete={() => void comments.remove(thread.id)}
                  t={t}
                />
              ))}
          </section>
        )}
      </div>
    </aside>
  );
}

/**
 * Where the comment will go, and the words. Disabled, with the reason, when
 * there is nowhere to put it yet.
 */
function Composer({
  target,
  label,
  chosen,
  onClear,
  onSend,
  t,
}: {
  target: CommentAnchor | null;
  label: string | null;
  /** The target came from the menu, and may be let go of. */
  chosen: boolean;
  onClear: () => void;
  onSend: (body: string) => Promise<boolean>;
  t: Translate;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // A target chosen from the menu is a target to write about now.
  useEffect(() => {
    if (chosen) field.current?.focus();
  }, [chosen]);

  const send = async () => {
    const text = body.trim();
    if (!text || !target || busy) return;
    setBusy(true);
    const ok = await onSend(text);
    setBusy(false);
    if (ok) setBody('');
  };

  return (
    <form
      className="comment-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="comment-target">
        <span className={`comment-target-label${target ? '' : ' is-empty'}`}>
          {label ?? t('comments.pickTarget')}
        </span>
        {chosen && (
          <button
            type="button"
            className="icon-button comment-target-clear"
            aria-label={t('comments.cancel')}
            title={t('comments.cancel')}
            onClick={onClear}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <textarea
        ref={field}
        className="input is-multiline comment-field"
        rows={3}
        value={body}
        placeholder={t('comments.placeholder')}
        aria-label={t('comments.send')}
        disabled={!target || busy}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, as in every chat; Shift+Enter is a new line.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="comment-composer-actions">
        <button
          type="button"
          className="button is-primary is-small"
          disabled={!target || !body.trim() || busy}
          onClick={() => void send()}
        >
          {t('comments.send')}
        </button>
      </div>
    </form>
  );
}

function Thread({
  thread,
  focused,
  label,
  selfId,
  canModerate,
  onReveal,
  onReply,
  onResolve,
  onDelete,
  t,
}: {
  thread: CommentThread;
  focused: boolean;
  label: string;
  selfId: string;
  canModerate: boolean;
  onReveal: () => void;
  onReply: (body: string) => Promise<boolean>;
  onResolve: () => void;
  onDelete: () => void;
  t: Translate;
}) {
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const settled = thread.resolvedAt !== null;
  const mine = thread.comments[0].author.id === selfId;
  // One's own name is "you", in the reader's language, not the profile's word for it.
  const nameOf = (author: { id: string; name: string }) =>
    author.id === selfId ? t('comments.you') : author.name;

  const send = async () => {
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await onReply(text);
    setBusy(false);
    if (ok) setReply('');
  };

  return (
    <article
      className={`comment-thread${settled ? ' is-resolved' : ''}${focused ? ' is-focused' : ''}`}
      data-thread-id={thread.id}
    >
      <button type="button" className="comment-anchor" onClick={onReveal}>
        {label}
      </button>
      {thread.comments.map((comment) => {
        const name = nameOf(comment.author);
        return (
          <div key={comment.id} className="comment-row">
            <span
              className="comment-avatar"
              style={{ '--user-color': colorForUser(comment.author.id) } as React.CSSProperties}
              aria-hidden="true"
            >
              {initials(name)}
            </span>
            <div className="comment-body">
              <div className="comment-meta">
                <b>{name}</b>
                <time dateTime={comment.createdAt}>{when(comment.createdAt, t)}</time>
              </div>
              <p className="comment-text">{comment.body}</p>
            </div>
          </div>
        );
      })}
      {settled && thread.resolvedBy && (
        <p className="comment-settled">
          {t('comments.resolvedBy', { name: nameOf(thread.resolvedBy) })}
        </p>
      )}
      {!settled && (
        <form
          className="comment-reply"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input
            className="input"
            value={reply}
            placeholder={t('comments.replyPlaceholder')}
            aria-label={t('comments.reply')}
            disabled={busy}
            onChange={(e) => setReply(e.target.value)}
          />
        </form>
      )}
      <div className="comment-actions">
        <button type="button" className="button is-small" onClick={onResolve}>
          {t(settled ? 'comments.reopen' : 'comments.resolve')}
        </button>
        {(mine || canModerate) && (
          <button
            type="button"
            className="icon-button is-danger"
            aria-label={t('comments.delete')}
            title={t('comments.delete')}
            onClick={onDelete}
          >
            <TrashIcon size={13} />
          </button>
        )}
      </div>
    </article>
  );
}
