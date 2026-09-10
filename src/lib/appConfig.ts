import { z } from 'zod';

/**
 * How this deployment is configured, as the server reports it.
 *
 * `local` is the browser-only editor: diagrams in IndexedDB, no accounts.
 * `server` means PostgreSQL behind the API and sign-in through the company's
 * identity provider; a diagram is seen by its owner and the people they let in.
 * The browser asks once at start-up and everything else follows from the answer.
 */
export const AppConfigSchema = z.object({
  mode: z.enum(['local', 'server']),
  auth: z
    .object({
      loginUrl: z.string(),
      logoutUrl: z.string(),
    })
    .optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

export const LOCAL_CONFIG: AppConfig = { mode: 'local' };

/**
 * Fetches the configuration, falling back to local mode when the server does
 * not answer: a deployment without the API is exactly the local editor, and a
 * transient failure must not lock somebody out of their own browser's diagrams.
 */
export async function fetchAppConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  try {
    const response = await fetchImpl('/api/config', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return LOCAL_CONFIG;
    const parsed = AppConfigSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : LOCAL_CONFIG;
  } catch {
    return LOCAL_CONFIG;
  }
}

/**
 * When this build was made, as the interface says it: "9 sep, 17:42".
 *
 * Baked in at build time by `next.config.ts`. A person who has just been told
 * "it is deployed" should be able to see that it reached them.
 */
export function buildStamp(
  locale: string,
  now: string | undefined = process.env.NEXT_PUBLIC_BUILD_STAMP,
): string {
  if (!now) return '';
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
