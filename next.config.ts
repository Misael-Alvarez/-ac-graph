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
