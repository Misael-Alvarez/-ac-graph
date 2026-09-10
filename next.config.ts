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
};

export default nextConfig;
