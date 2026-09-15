import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  /* When this build was made, shown in the account menu and the home footer,
     so "did the new version reach me?" has an answer without opening devtools. */
  env: {
    NEXT_PUBLIC_BUILD_STAMP: new Date().toISOString(),
  },
  /* The dev overlay badge sits bottom-left, exactly where the zoom controls
     live, and swallows clicks on them. Nothing in development needs it there. */
  devIndicators: false,
  /* The HTML documents ask the browser to check back every time.

     Next serves a prerendered page with `s-maxage=31536000`, a directive for
     CDNs that browsers ignore — and with nothing said to the browser, a tab
     reopened or a URL retyped could reuse the shell it had, whose hashed
     chunks were still in cache too: the old build, whole, after a deploy, and
     a "Loading…" that never ends once those chunks were gone from the server.
     `no-cache` keeps the copy but revalidates it (an ETag round trip, a 304
     when nothing changed), so the next reload is always the current build.
     Hashed assets under /_next/static stay immutable; the API sets its own. */
  async headers() {
    return [
      {
        source: '/((?!api/|_next/|.*\\..*).*)',
        headers: [{ key: 'Cache-Control', value: 'no-cache, must-revalidate' }],
      },
    ];
  },
  /* The OpenTelemetry SDK is loaded only when a collector is configured, and
     Next.js requires `@opentelemetry/api` itself: both must resolve to the one
     copy in node_modules rather than be bundled into each route. */
  serverExternalPackages: [
    '@opentelemetry/api',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/semantic-conventions',
  ],
};

export default nextConfig;
