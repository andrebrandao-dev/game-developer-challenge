import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

// The MSW service worker forwards every request it does not mock (assets
// included). Expose those worker fetches to Playwright so tests can route them.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
const isCI = !!process.env.CI;
/** Set to run the suite against a deployed URL instead of a local build. */
const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

/**
 * E2E suite runs against the production build (vite build + preview), so it
 * exercises exactly what is deployed, including the MSW worker.
 *
 * - desktop-chromium: full suite.
 * - mobile-chromium: main flows tagged @mobile (touch, landscape phone).
 */
export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // Each worker runs a WebGL game; more than a few in parallel starve the GPU.
  workers: isCI ? 2 : 4,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: remoteBaseUrl ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      grep: /@mobile/,
      use: { ...devices['Pixel 7 landscape'] },
    },
  ],
  webServer: remoteBaseUrl
    ? undefined
    : {
        command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !isCI,
        timeout: 180_000,
      },
});
