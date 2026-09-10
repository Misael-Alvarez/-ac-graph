import type { Instrumentation } from 'next';

/**
 * Next.js instrumentation hooks (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`).
 *
 * `register` runs once per server start; `onRequestError` runs for errors
 * Next.js catches itself. Both defer to `src/server/observability`, imported
 * lazily so this file stays valid for the Edge runtime that never uses it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startObservability } = await import('./server/observability/startup');
  await startObservability();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { reportRequestError } = await import('./server/observability/startup');
  reportRequestError(error, request, context);
};
