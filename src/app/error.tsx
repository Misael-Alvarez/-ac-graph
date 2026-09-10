'use client';

import { useEffect } from 'react';
import { PageState } from '@/components/app/PageState';

/**
 * The route-level boundary. Saved work lives in the store, not in React state,
 * so recovering is a re-render away; the error itself is logged for whoever
 * runs the server, never shown raw to the person in front of the screen.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <PageState kind="error" onRetry={reset} />;
}
