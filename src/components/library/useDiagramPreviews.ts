'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiagramMeta, DiagramModel } from '@/lib/domain';
import type { DiagramRepository } from '@/lib/store';
import { renderPreview } from '@/lib/store/preview';
import { thumbnailDataUrl } from '@/lib/store/thumbnail';

/** A diagram drawn small, in the current theme, with the model it came from. */
export interface DiagramPreview {
  model: DiagramModel;
  /** `renderPreview(model, dark)` as a data URL, ready for an `<img src>`. */
  src: string;
}

/** How many models are read at once. The store is local, but the list is not small. */
const CONCURRENCY = 4;
/** Models and drawings kept after their card has scrolled away. */
const CACHE_LIMIT = 96;

const revisionOf = (meta: DiagramMeta) => `${meta.id}@${meta.updatedAt}`;

/** Keeps a map bounded by dropping what went in first. */
function remember<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value as K;
    cache.delete(oldest);
  }
}

/**
 * The queue behind the hook: which revisions are wanted, which are being read,
 * which are known — and the observer that adds a revision to the wanted set
 * when its card scrolls into view. Plain state in one object, so the hook's
 * effects can attach and detach it without recreating anything in between.
 */
class PreviewLoader {
  /** Model per revision; `null` for a diagram that is gone. */
  readonly known = new Map<string, DiagramModel | null>();
  /** Drawing per `${revision}@${dark}`. */
  readonly drawings = new Map<string, string>();
  private readonly wanted = new Set<string>();
  private readonly inflight = new Set<string>();
  private byRevision = new Map<string, DiagramMeta>();
  private source: DiagramRepository | null = null;
  private onChange: (() => void) | null = null;
  private observer: IntersectionObserver | null = null;

  attach(source: DiagramRepository, onChange: () => void) {
    this.source = source;
    this.onChange = onChange;
    this.pump();
  }

  /* The observer stays: every card unobserves itself as it unmounts, and an
     effect that ran twice in development would otherwise leave cards watched
     by an observer that had already been thrown away. */
  detach() {
    this.onChange = null;
  }

  /** The revisions currently listed; anything else wanted is forgotten. */
  index(items: readonly DiagramMeta[]) {
    this.byRevision = new Map(items.map((meta) => [revisionOf(meta), meta]));
    for (const revision of this.wanted) {
      if (!this.byRevision.has(revision)) this.wanted.delete(revision);
    }
  }

  want(revision: string) {
    this.wanted.add(revision);
    this.pump();
  }

  /** Starts loading a card's diagram once the element is in view; returns the way to stop watching. */
  observe(element: Element, revision: string): () => void {
    (element as HTMLElement).dataset.previewRevision = revision;
    this.observer ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const seen = (entry.target as HTMLElement).dataset.previewRevision;
          if (seen) this.wanted.add(seen);
        }
        this.pump();
      },
      // A little ahead of the fold, so a card is drawn by the time it arrives.
      { rootMargin: '25% 0px' },
    );
    const observer = this.observer;
    observer.observe(element);
    return () => observer.unobserve(element);
  }

  private pump() {
    const source = this.source;
    if (!source) return;
    for (const revision of this.wanted) {
      if (this.inflight.size >= CONCURRENCY) return;
      if (this.known.has(revision) || this.inflight.has(revision)) continue;
      const meta = this.byRevision.get(revision);
      if (!meta) continue;
      this.inflight.add(revision);
      source.get(meta.id).then(
        (record) => {
          this.inflight.delete(revision);
          remember(this.known, revision, record?.model ?? null);
          this.onChange?.();
          this.pump();
        },
        () => {
          // A failed read is tried again the next time the card comes into view.
          this.inflight.delete(revision);
          this.wanted.delete(revision);
          this.pump();
        },
      );
    }
  }
}

/**
 * The real drawing of each diagram, for the cards on the home page.
 *
 * The list carries only metadata; a card that shows what the diagram looks
 * like needs its model. Reading every model up front would make the page
 * slow for pictures nobody scrolled to, so each card asks for its own when it
 * comes into view — `observe(meta)` is the ref a card attaches — a few at a
 * time, and the drawings are kept per revision and theme so a theme switch or
 * a return to the page redraws nothing that was already drawn. `eager` reads
 * everything at once, for the handful of starting points of the reader's own.
 */
export function useDiagramPreviews(
  repository: DiagramRepository,
  items: readonly DiagramMeta[],
  dark: boolean,
  { eager = false }: { eager?: boolean } = {},
): {
  /** By diagram id, for the revision currently listed; absent while loading. */
  previews: ReadonlyMap<string, DiagramPreview>;
  /** The ref for a card's element: it loads once the element is in view. */
  observe: (meta: DiagramMeta) => (element: Element | null) => (() => void) | undefined;
} {
  const [loader] = useState(() => new PreviewLoader());
  const [models, setModels] = useState<ReadonlyMap<string, DiagramModel | null>>(() => new Map());

  useEffect(() => {
    loader.attach(repository, () => setModels(new Map(loader.known)));
    return () => loader.detach();
  }, [loader, repository]);

  useEffect(() => {
    loader.index(items);
    if (eager) for (const meta of items) loader.want(revisionOf(meta));
  }, [loader, items, eager]);

  const observe = useCallback(
    (meta: DiagramMeta) => (element: Element | null) => {
      if (!element) return undefined;
      return loader.observe(element, revisionOf(meta));
    },
    [loader],
  );

  const previews = useMemo(() => {
    const out = new Map<string, DiagramPreview>();
    for (const meta of items) {
      const revision = revisionOf(meta);
      const model = models.get(revision);
      if (!model) continue;
      const key = `${revision}@${dark}`;
      let src = loader.drawings.get(key);
      if (!src) {
        src = thumbnailDataUrl(renderPreview(model, dark));
        remember(loader.drawings, key, src);
      }
      out.set(meta.id, { model, src });
    }
    return out;
  }, [items, models, dark, loader]);

  return { previews, observe };
}
