import { defineConfig } from '@playwright/test';

const PORT = 4174;
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

/**
 * Profiling run (not part of the regular E2E suite): optimised build, one
 * worker, full Chromium in new-headless mode (real frame scheduling), 1920×1080.
 * Writes docs/perf/report.json and docs/perf/REPORT.md.
 */
export default defineConfig({
  testDir: './perf',
  workers: 1,
  timeout: 15 * 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chromium',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] },
  },
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
