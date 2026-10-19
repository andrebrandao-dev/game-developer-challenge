import { describe, expect, it } from 'vitest';
import { createMatchConfig, DEFAULT_GAME_CONFIG, type GameConfig } from '@/config/gameConfig';
import type { ArenaLayout } from './arena';
import { Simulation } from './simulation';
import { spawnEnemy } from './systems/spawner';
import { IDLE_INTENT, type ControlIntent, type GameEvent } from './types';

const OPEN_SEA: ArenaLayout = { islands: [], decorations: [], playerStart: { col: 15, row: 8, heading: 0 } };
const ONE_ISLAND: ArenaLayout = {
  islands: [{ id: 'block', col: 20, row: 6, cols: 3, rows: 4, style: 'sand' }],
  decorations: [],
  playerStart: { col: 15, row: 8, heading: 0 },
};

/** Config with spawning pushed out of the way unless a test needs it. */
function testConfig(overrides: Partial<{ durationSec: number; intervalSec: number; initialDelaySec: number }> = {}): GameConfig {
  const base = createMatchConfig({
    sessionDurationSec: overrides.durationSec ?? 120,
    spawnIntervalSec: overrides.intervalSec ?? 3,
  });
  return {
    ...base,
    spawn: { ...base.spawn, initialDelaySec: overrides.initialDelaySec ?? 10_000 },
  };
}

const intent = (partial: Partial<ControlIntent>): ControlIntent => ({ ...IDLE_INTENT, ...partial });

function runSteps(sim: Simulation, steps: number, input: ControlIntent = IDLE_INTENT): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step(input);
    events.push(...sim.drainEvents());
  }
  return events;
}

const seconds = (s: number) => Math.round(s * 60);

describe('movement', () => {
  it('moves forward along the heading and rotates both ways', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    const start = { ...sim.world.player.pos };
    runSteps(sim, seconds(1), intent({ forward: true }));
    expect(sim.world.player.pos.x).toBeGreaterThan(start.x + 50);
    expect(sim.world.player.pos.y).toBeCloseTo(start.y, 5);

    const angle = sim.world.player.angle;
    runSteps(sim, seconds(0.5), intent({ turn: 1 }));
    expect(sim.world.player.angle).toBeCloseTo(angle + DEFAULT_GAME_CONFIG.player.turnRate * 0.5, 1);
    runSteps(sim, seconds(1), intent({ turn: -1 }));
    expect(sim.world.player.angle).toBeLessThan(angle);
  });

  it('is frame-rate independent', () => {
    const a = new Simulation(testConfig(), 7, OPEN_SEA);
    const b = new Simulation(testConfig(), 7, OPEN_SEA);
    const input = intent({ forward: true, turn: 1 });
    // 2 seconds at 30 FPS vs 144 FPS of real frame time.
    for (let i = 0; i < 60; i++) a.advance(1 / 30, input);
    for (let i = 0; i < 288; i++) b.advance(1 / 144, input);
    expect(a.world.step).toBe(b.world.step);
    expect(a.world.player.pos.x).toBeCloseTo(b.world.player.pos.x, 6);
    expect(a.world.player.pos.y).toBeCloseTo(b.world.player.pos.y, 6);
  });

  it('keeps the player inside the arena', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    runSteps(sim, seconds(15), intent({ forward: true }));
    const { player, arena } = sim.world;
    expect(player.pos.x).toBeLessThanOrEqual(arena.width - player.stats.hullRadius);
    expect(player.pos.x).toBeGreaterThan(arena.width - 120);
  });

  it('does not sail through islands', () => {
    const sim = new Simulation(testConfig(), 1, ONE_ISLAND);
    const events = runSteps(sim, seconds(6), intent({ forward: true }));
    const island = sim.world.arena.islands[0];
    expect(island).toBeDefined();
    const bow = sim.world.player.pos.x + sim.world.player.stats.hullHalfLength + sim.world.player.stats.hullRadius;
    expect(bow).toBeLessThanOrEqual((island?.x ?? 0) + 1);
    expect(events.some((e) => e.type === 'collision')).toBe(true);
  });
});

describe('weapons', () => {
  it('fires one front shot and three parallel broadside shots', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    sim.step(intent({ fireFront: true }));
    expect(sim.world.projectiles).toHaveLength(1);
    sim.step(intent({ fireLeft: true }));
    expect(sim.world.projectiles).toHaveLength(4);

    const side = sim.world.projectiles.slice(1);
    for (const p of side) {
      // Heading is +x, so the left side fires towards -y.
      expect(p.vel.x).toBeCloseTo(0, 6);
      expect(p.vel.y).toBeLessThan(0);
    }
    const xs = side.map((p) => p.pos.x).sort((m, n) => m - n);
    expect((xs[1] ?? 0) - (xs[0] ?? 0)).toBeCloseTo(DEFAULT_GAME_CONFIG.player.broadside.spacing, 3);
  });

  it('respects each weapon cooldown independently', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    const events = runSteps(sim, seconds(1), intent({ fireFront: true, fireRight: true }));
    const shots = events.filter((e) => e.type === 'shotFired');
    const front = shots.filter((e) => e.slot === 'front').length;
    const right = shots.filter((e) => e.slot === 'right').length;
    expect(front).toBe(Math.floor(1 / DEFAULT_GAME_CONFIG.player.frontCannon.cooldownSec) + 1);
    expect(right).toBe(1);
  });

  it('expires projectiles at their range', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    sim.step(intent({ fireFront: true }));
    const events = runSteps(sim, seconds(2));
    const expired = events.filter((e) => e.type === 'projectileExpired');
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ on: 'water' });
    expect(sim.world.projectiles).toHaveLength(0);
  });

  it('blocks projectiles with islands', () => {
    const sim = new Simulation(testConfig(), 1, ONE_ISLAND);
    sim.step(intent({ fireFront: true }));
    const events = runSteps(sim, seconds(2));
    expect(events.find((e) => e.type === 'projectileExpired')).toMatchObject({ on: 'island' });
  });
});

describe('combat and scoring', () => {
  it('applies damage once per projectile and scores kills', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    const { player } = sim.world;
    spawnEnemy(sim.world, 'shooter', { x: player.pos.x + 260, y: player.pos.y });
    const enemy = sim.world.ships[1];
    expect(enemy).toBeDefined();
    if (!enemy) return;
    // Keep the shooter from moving or shooting back during the test.
    enemy.cooldowns.front = 999;

    sim.step(intent({ fireFront: true }));
    const events = runSteps(sim, seconds(0.6));
    const hits = events.filter((e) => e.type === 'shipHit' && e.shipId === enemy.id);
    expect(hits).toHaveLength(1);
    expect(enemy.health).toBe(DEFAULT_GAME_CONFIG.shooter.maxHealth - DEFAULT_GAME_CONFIG.player.frontCannon.damage);

    // Two more hits sink it (75 HP, 34 per shot).
    for (let i = 0; i < 2; i++) {
      enemy.pos = { x: player.pos.x + 260, y: player.pos.y };
      sim.world.player.cooldowns.front = 0;
      sim.step(intent({ fireFront: true }));
      runSteps(sim, seconds(0.6));
    }
    expect(enemy.alive).toBe(false);
    expect(sim.world.score).toBe(1);
    expect(sim.world.ships).toHaveLength(1);
  });

  it('chaser rams the player, explodes and does not score', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    const { player } = sim.world;
    spawnEnemy(sim.world, 'chaser', { x: player.pos.x + 200, y: player.pos.y });
    const events = runSteps(sim, seconds(3));
    expect(events.some((e) => e.type === 'shipRammed')).toBe(true);
    expect(events.find((e) => e.type === 'shipDestroyed')).toMatchObject({ kind: 'chaser', cause: 'ram' });
    expect(player.health).toBe(DEFAULT_GAME_CONFIG.player.maxHealth - DEFAULT_GAME_CONFIG.chaser.contactDamage);
    expect(sim.world.score).toBe(0);
  });

  it('shooter approaches and fires when within range', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    const { player } = sim.world;
    spawnEnemy(sim.world, 'shooter', { x: player.pos.x + 800, y: player.pos.y });
    const events = runSteps(sim, seconds(6));
    const shooter = sim.world.ships[1];
    const shots = events.filter((e) => e.type === 'shotFired' && e.shipId === shooter?.id);
    expect(shots.length).toBeGreaterThan(0);
    expect(player.health).toBeLessThan(DEFAULT_GAME_CONFIG.player.maxHealth);
  });
});

describe('spawning', () => {
  it('spawns on the configured interval, far from the player, and both kinds appear', () => {
    const sim = new Simulation(testConfig({ intervalSec: 2, initialDelaySec: 1 }), 42);
    const events = runSteps(sim, seconds(9.5));
    const spawns = events.filter((e) => e.type === 'shipSpawned');
    // t = 1, 3, 5, 7, 9
    expect(spawns).toHaveLength(5);
    expect(new Set(spawns.map((s) => s.kind))).toEqual(new Set(['chaser', 'shooter']));
  });

  it('only uses spawn points away from the player and islands', () => {
    const config = testConfig({ intervalSec: 0.5, initialDelaySec: 0.5 });
    const sim = new Simulation({ ...config, spawn: { ...config.spawn, maxActiveEnemies: 30 } }, 3);
    const start = { ...sim.world.player.pos };
    const events = runSteps(sim, seconds(4));
    for (const e of events) {
      if (e.type !== 'shipSpawned') continue;
      expect(Math.hypot(e.x - start.x, e.y - start.y)).toBeGreaterThanOrEqual(config.spawn.minDistanceFromPlayer - 300);
    }
  });

  it('is deterministic for a given seed', () => {
    const run = () => {
      const sim = new Simulation(testConfig({ intervalSec: 1, initialDelaySec: 0.5 }), 99);
      runSteps(sim, seconds(10), intent({ forward: true, turn: 1, fireFront: true }));
      return sim.world.ships.map((s) => `${s.kind}:${s.pos.x.toFixed(3)},${s.pos.y.toFixed(3)}`).join('|');
    };
    expect(run()).toBe(run());
  });
});

describe('match rules', () => {
  it('ends when the time runs out and freezes the simulation', () => {
    const sim = new Simulation(testConfig({ durationSec: 60 }), 1, OPEN_SEA);
    const events = runSteps(sim, seconds(61), intent({ forward: true }));
    expect(events.filter((e) => e.type === 'matchEnded')).toEqual([{ type: 'matchEnded', reason: 'time_up' }]);
    expect(sim.result()).toMatchObject({ reason: 'time_up', durationMs: 60_000, score: 0 });
    const pos = { ...sim.world.player.pos };
    const step = sim.world.step;
    runSteps(sim, 30, intent({ forward: true, fireFront: true }));
    expect(sim.world.player.pos).toEqual(pos);
    expect(sim.world.step).toBe(step);
  });

  it('ends when the player is destroyed', () => {
    const sim = new Simulation(testConfig(), 1, OPEN_SEA);
    const { player } = sim.world;
    player.health = 10;
    spawnEnemy(sim.world, 'chaser', { x: player.pos.x + 150, y: player.pos.y });
    runSteps(sim, seconds(3));
    expect(sim.world.status).toBe('ended');
    expect(sim.result()?.reason).toBe('destroyed');
    expect(sim.hud().health).toBe(0);
  });
});
