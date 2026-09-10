/**
 * Process-wide singletons.
 *
 * Next.js compiles every route handler into its own bundle, so a module-level
 * `const pool = new Pool()` would give each route — and each dev-server hot
 * reload — its own copy. Anything that must exist once per process (the
 * connection pool, the presence registry, the event hub, the monotonic clock)
 * is parked on `globalThis` under a single namespaced key instead.
 */

const NAMESPACE = '__acGraphServer__';

type Store = Map<string, unknown>;

function store(): Store {
  const host = globalThis as typeof globalThis & { [NAMESPACE]?: Store };
  host[NAMESPACE] ??= new Map();
  return host[NAMESPACE];
}

export function singleton<T>(name: string, create: () => T): T {
  const registry = store();
  if (!registry.has(name)) registry.set(name, create());
  return registry.get(name) as T;
}

/** The current value without creating one. */
export function peekSingleton<T>(name: string): T | undefined {
  return store().get(name) as T | undefined;
}

/** Drops one singleton so the next `singleton()` call rebuilds it. Tests and shutdown only. */
export function resetSingleton(name: string): void {
  store().delete(name);
}
