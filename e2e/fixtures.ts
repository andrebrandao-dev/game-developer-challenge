import { test as base, expect, type Page } from '@playwright/test';
import type { PirateBattleTestApi } from '../src/testing/testHooks';

export type GameState = NonNullable<ReturnType<PirateBattleTestApi['session']['state']>>;

export interface AppOptions {
  /** Manual simulation clock (default true): time only moves through `game.advance`. */
  manualClock?: boolean;
  seed?: number;
  scenario?: string;
  apiTimeoutMs?: number;
  hash?: string;
  /**
   * Balancing overrides deep-merged into the base config (test hooks only),
   * e.g. a sturdy player so a match reliably reaches its time limit.
   */
  configOverrides?: Record<string, unknown>;
}

/** Player that cannot realistically sink, for flows that need a time-up ending. */
export const STURDY_PLAYER = { player: { maxHealth: 100_000 } };

export function appUrl(options: AppOptions = {}): string {
  const params = new URLSearchParams({ testHooks: '1' });
  if (options.manualClock ?? true) params.set('clock', 'manual');
  params.set('seed', String(options.seed ?? 7));
  if (options.scenario) params.set('scenario', options.scenario);
  if (options.apiTimeoutMs) params.set('apiTimeout', String(options.apiTimeoutMs));
  return `/?${params.toString()}${options.hash ?? ''}`;
}

/** Thin driver over window.__pirateBattle. Gameplay still uses real input. */
export class GameDriver {
  constructor(private readonly page: Page) {}

  async open(options: AppOptions = {}): Promise<void> {
    if (options.configOverrides) {
      await this.page.addInitScript((overrides) => {
        window.localStorage.setItem('pirate-battle:test-config-overrides', JSON.stringify(overrides));
      }, options.configOverrides);
    }
    await this.page.goto(appUrl(options));
    await expect(this.page.getByRole('button', { name: 'Play' }).or(this.page.getByTestId('result-screen')).or(this.page.getByTestId('captains-log')).first()).toBeVisible();
  }

  async startBattle(): Promise<void> {
    await this.page.getByRole('button', { name: 'Play', exact: true }).click();
    await this.waitForPhase('running');
  }

  async waitForPhase(phase: GameState['phase']): Promise<void> {
    await expect.poll(() => this.page.evaluate(() => window.__pirateBattle?.session.state()?.phase ?? null)).toBe(phase);
  }

  state(): Promise<GameState> {
    return this.page.evaluate(() => {
      const s = window.__pirateBattle?.session.state();
      if (!s) throw new Error('No active session');
      return s;
    });
  }

  /** Advances game time with whatever input is currently held. */
  advance(ms: number): Promise<number> {
    return this.page.evaluate((t) => window.__pirateBattle?.session.advance(t) ?? 0, ms);
  }

  spawn(kind: 'chaser' | 'shooter', x: number, y: number): Promise<number> {
    return this.page.evaluate(([k, px, py]) => window.__pirateBattle?.session.spawnEnemy(k, px, py) ?? -1, [kind, x, y] as const);
  }

  /** Holds keys for `ms` of game time, then releases them. */
  async hold(keys: string[], ms: number): Promise<void> {
    for (const key of keys) await this.page.keyboard.down(key);
    await this.advance(ms);
    for (const key of keys) await this.page.keyboard.up(key);
  }

  selectScenario(id: string): Promise<void> {
    return this.page.evaluate((s) => window.__pirateBattle?.mocks.select(s), id);
  }

  outbox() {
    return this.page.evaluate(() => window.__pirateBattle?.mocks.outbox());
  }

  serverRecordCount(): Promise<number> {
    return this.page.evaluate(() => window.__pirateBattle?.mocks.records() ?? 0);
  }

  /** Sets the options through the UI. */
  async setOptions(sessionSec: number, spawnSec: number): Promise<void> {
    await this.page.getByRole('button', { name: 'Options' }).click();
    await this.page.getByRole('spinbutton', { name: 'Game session time' }).fill(String(sessionSec));
    await this.page.getByRole('spinbutton', { name: 'Enemy spawn time' }).fill(String(spawnSec));
    const save = this.page.getByRole('button', { name: 'Save' });
    if (await save.isEnabled()) await save.click();
    await this.page.getByRole('button', { name: 'Main menu' }).click();
  }

  /** Plays a full match to its time limit (default 60 s match). */
  async playUntilTimeUp(): Promise<void> {
    const s = await this.state();
    await this.advance((s.config.durationSec - s.time) * 1000 + 100);
    await expect(this.page.getByTestId('result-screen')).toBeVisible();
  }
}

/** Messages that are not application errors. */
const IGNORED_CONSOLE = [/GPU stall due to ReadPixels/, /WebGL/i];

export const test = base.extend<{ game: GameDriver; consoleGuard: void }>({
  game: async ({ page }, use) => {
    await use(new GameDriver(page));
  },
  // Every flow must keep the console free of unhandled errors.
  consoleGuard: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        // Failed requests are expected in failure scenarios (they are handled by the app).
        if (/Failed to load resource/.test(text) && testInfo.tags.includes('@network-failures')) return;
        if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
        errors.push(text);
      });
      await use();
      expect(errors, 'unexpected console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
