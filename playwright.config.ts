import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL || 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  // Screenshots are compared at a fixed size in a fixed browser; anything looser
  // is noise. Baselines live beside the spec and are platform-suffixed.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  projects: [
    {
      // The functional suite: everything but the visual baselines.
      name: 'functional',
      testIgnore: /visual\.spec\.ts/,
    },
    {
      // Pixel baselines of the product's states. Run on purpose, not by default:
      // `npm run test:visual` (compare) and `npm run test:visual:update` (accept).
      name: 'visual',
      testMatch: /visual\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
  ],
  // Next 16 keeps production output in .next and development in .next/dev.
  // Never reuse an unrelated server; an explicit URL opts out of lifecycle control.
  webServer: externalBaseURL
    ? undefined
    : {
        command: process.env.CI ? 'npm run start' : 'npm run build && npm run start',
        url: `${baseURL}/api/health`,
        env: {
          HOSTNAME: '127.0.0.1',
          PORT: '3100',
          ANTHROPIC_API_KEY: '',
          NEXT_TELEMETRY_DISABLED: '1',
        },
        reuseExistingServer: false,
        timeout: 180_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
      },
});
