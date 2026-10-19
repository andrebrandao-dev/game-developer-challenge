import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../src/testing/testHooks';

/**
 * Performance & memory profiling.
 *
 *  1. Full 3-minute match (180 s session, 1 s spawn interval: the heaviest
 *     allowed enemy pressure) with a scripted pilot holding real keys, in
 *     real time. Records FPS, p95 frame time and entity counts.
 *  2. Five cycles of start → play 20 s → exit, measuring the JS heap (after
 *     forced GC), DOM nodes, event listeners and canvases after each cycle.
 */

const MATCH_SEC = 180;
const SPAWN_SEC = 1;
const CYCLES = 5;
const CYCLE_PLAY_MS = 20_000;
const OUT_DIR = 'docs/perf';

interface PerfSummary {
  frames: number;
  avgFps: number;
  avgFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  slowFrameRatio: number;
  maxEntities: number;
  avgEntities: number;
  avgWorkMs: number;
  p95WorkMs: number;
  maxWorkMs: number;
}

const params = '?testHooks=1&seed=2026';
const sturdy = { player: { maxHealth: 1_000_000 } };

async function setup(page: Page, sessionSec: number, spawnSec: number): Promise<void> {
  await page.addInitScript(
    ([overrides, options]) => {
      window.localStorage.setItem('pirate-battle:test-config-overrides', JSON.stringify(overrides));
      window.localStorage.setItem('pirate-battle:options:v1', JSON.stringify(options));
      window.localStorage.setItem('pirate-battle:audio-muted:v1', 'true');
    },
    [sturdy, { sessionDurationSec: sessionSec, spawnIntervalSec: spawnSec }] as const,
  );
  await page.goto(`/${params}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
}

async function startBattle(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__pirateBattle?.session.state()?.phase)).toBe('running');
}

/** Scripted pilot: sails, weaves and fires every weapon using real key events. */
async function pilot(page: Page, durationMs: number, onTick?: (elapsed: number) => Promise<void>): Promise<void> {
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  const start = Date.now();
  let phase = 0;
  while (Date.now() - start < durationMs) {
    const turn = phase % 4 < 2 ? 'KeyD' : 'KeyA';
    await page.keyboard.down(turn);
    await page.keyboard.press(phase % 2 === 0 ? 'KeyQ' : 'KeyE');
    await page.waitForTimeout(900);
    await page.keyboard.up(turn);
    await page.waitForTimeout(600);
    phase++;
    if (onTick) await onTick(Date.now() - start);
  }
  for (const key of ['KeyW', 'Space', 'KeyA', 'KeyD']) await page.keyboard.up(key);
}

async function memorySample(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  const canvases = await page.evaluate(() => document.querySelectorAll('canvas').length);
  await cdp.detach();
  return {
    heapMb: Math.round((usedSize / 1024 / 1024) * 100) / 100,
    domNodes: dom.nodes,
    listeners: dom.jsEventListeners,
    documents: dom.documents,
    canvases,
  };
}

function environment(browserVersion: string) {
  let chip = os.cpus()[0]?.model ?? 'unknown';
  try {
    chip = execSync('sysctl -n machdep.cpu.brand_string').toString().trim();
  } catch {
    // Not macOS.
  }
  return {
    date: new Date().toISOString(),
    hardware: `${chip}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / 1024 ** 3)} GB RAM`,
    os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    browser: `Chromium ${browserVersion} (new headless, GPU via ANGLE/Metal)`,
    resolution: '1920×1080 CSS px, devicePixelRatio 1',
    build: 'vite build (production), served by vite preview',
  };
}

test('profile: 3-minute match and 5 start/play/exit cycles', async ({ page, browser }) => {
  // ------------------------------------------------------------ 3-min match
  await setup(page, MATCH_SEC, SPAWN_SEC);
  await startBattle(page);

  const timeline: { t: number; ships: number; projectiles: number; particles: number; fps: number; p95: number }[] = [];
  await pilot(page, (MATCH_SEC - 2) * 1000, async (elapsed) => {
    if (timeline.length === 0 || elapsed - (timeline[timeline.length - 1]?.t ?? 0) * 1000 >= 10_000) {
      const sample = await page.evaluate(() => ({
        perf: window.__pirateBattle?.session.perf(),
        render: window.__pirateBattle?.session.renderStats(),
      }));
      if (sample.perf && sample.render) {
        timeline.push({
          t: Math.round(elapsed / 1000),
          ships: sample.render.ships,
          projectiles: sample.render.projectiles,
          particles: sample.render.particles,
          fps: sample.perf.avgFps,
          p95: sample.perf.p95FrameMs,
        });
      }
    }
  });
  const summary: PerfSummary | null = await page.evaluate(() => window.__pirateBattle?.session.perf() ?? null);
  expect(summary).not.toBeNull();
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 15_000 });

  // ------------------------------------------------------ memory cycles
  await page.goto(`/${params}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  const baseline = await memorySample(page);
  const cycles: (Awaited<ReturnType<typeof memorySample>> & { cycle: number })[] = [];
  for (let i = 1; i <= CYCLES; i++) {
    await startBattle(page);
    await pilot(page, CYCLE_PLAY_MS);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Main menu' }).click();
    await page.getByRole('button', { name: 'Abandon' }).click();
    await expect(page.getByTestId('main-menu')).toBeVisible();
    cycles.push({ cycle: i, ...(await memorySample(page)) });
  }

  const env = environment(browser.version());
  const report = {
    environment: env,
    match: { sessionDurationSec: MATCH_SEC, spawnIntervalSec: SPAWN_SEC, seed: 2026, pilot: 'scripted: sail, weave, all weapons' },
    frames: summary,
    timeline,
    memory: { baseline, cycles },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

  const f = summary as PerfSummary;
  const md = [
    '# Performance report',
    '',
    '_Generated by `pnpm perf` (perf/profile.spec.ts). Raw data: [report.json](report.json). Interpretation and memory investigation: [ANALYSIS.md](ANALYSIS.md)._',
    '',
    '## Environment',
    '',
    ...Object.entries(env).map(([k, v]) => `- **${k}**: ${v}`),
    '',
    '## 3-minute match',
    '',
    `Match: ${MATCH_SEC} s session, ${SPAWN_SEC} s spawn interval (maximum enemy pressure), seed 2026, scripted pilot holding real keys. Target: 60 FPS.`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Frames recorded | ${f.frames} |`,
    `| Average FPS | ${f.avgFps} |`,
    `| Average frame time | ${f.avgFrameMs} ms |`,
    `| p50 frame time | ${f.p50FrameMs} ms |`,
    `| **p95 frame time** | **${f.p95FrameMs} ms** |`,
    `| p99 frame time | ${f.p99FrameMs} ms |`,
    `| Max frame time | ${f.maxFrameMs} ms |`,
    `| Frames over 17.7 ms | ${(f.slowFrameRatio * 100).toFixed(1)} % |`,
    `| Simulated entities (ships + projectiles), avg / max | ${f.avgEntities} / ${f.maxEntities} |`,
    `| CPU work per frame (sim + scene + render submit), avg / p95 / max | ${f.avgWorkMs} / ${f.p95WorkMs} / ${f.maxWorkMs} ms |`,
    '',
    '### Timeline (every ~10 s)',
    '',
    '| t (s) | Ships | Projectiles | Particles | Avg FPS so far | p95 so far (ms) |',
    '| --- | --- | --- | --- | --- | --- |',
    ...timeline.map((r) => `| ${r.t} | ${r.ships} | ${r.projectiles} | ${r.particles} | ${r.fps} | ${r.p95} |`),
    '',
    '## Memory: 5 × (start → play 20 s → exit)',
    '',
    'Measured on the main menu after each cycle, after two forced garbage collections.',
    '',
    '| Sample | JS heap (MB) | DOM nodes | JS listeners | Canvases |',
    '| --- | --- | --- | --- | --- |',
    `| Baseline (menu) | ${baseline.heapMb} | ${baseline.domNodes} | ${baseline.listeners} | ${baseline.canvases} |`,
    ...cycles.map((c) => `| After cycle ${c.cycle} | ${c.heapMb} | ${c.domNodes} | ${c.listeners} | ${c.canvases} |`),
    '',
  ].join('\n');
  writeFileSync(`${OUT_DIR}/REPORT.md`, md);

  // Sanity: no leaked canvases and no continuous growth of listeners.
  for (const c of cycles) expect(c.canvases).toBe(0);
  const last = cycles[cycles.length - 1];
  const first = cycles[0];
  if (last && first) expect(last.listeners).toBeLessThanOrEqual(first.listeners + 5);
});
