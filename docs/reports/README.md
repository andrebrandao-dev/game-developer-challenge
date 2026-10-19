# Test reports

| Report | How it was produced |
| --- | --- |
| [e2e/index.html](e2e/index.html) | Playwright HTML report of the full E2E suite (`pnpm test:e2e`): 51 passed, 2 skipped by design (the touch test only runs on mobile; the keyboard movement test is skipped on mobile). Desktop and mobile Chromium, production build. Generated 2026-10-19. |
| [../perf/REPORT.md](../perf/REPORT.md) | Profiling run (`pnpm perf`), with the analysis in [../perf/ANALYSIS.md](../perf/ANALYSIS.md). |

Open the E2E report locally with `pnpm exec playwright show-report docs/reports/e2e` (or open
`index.html` in a browser).

Traces, videos and screenshots are kept for **failed** tests only (`trace: 'retain-on-failure'`),
in `test-results/<test>/`. The committed run had no failures, so it contains none. To inspect a
failure: `pnpm exec playwright show-trace test-results/<test>/trace.zip`.

Unit tests (`pnpm test:unit`): 20 Vitest tests, including three full 180 s soak matches.
