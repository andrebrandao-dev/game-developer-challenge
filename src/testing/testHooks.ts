import type { QueryClient } from '@tanstack/react-query';
import type { EnemyKind } from '@/config/gameConfig';
import type { GameSession } from '@/game/GameSession';
import { outboxStore } from '@/api/pendingRecords';
import { mockDb, mockScenario } from '@/mocks/db';
import { resetNetworkState, selectScenario } from '@/mocks/browser';

/**
 * Test instrumentation, exposed as `window.__pirateBattle` only with
 * `?testHooks=1`. It can observe state and control the clock; gameplay still
 * runs through the real input, simulation, collision and render code.
 */
export interface PirateBattleTestApi {
  session: {
    active(): boolean;
    state(): ReturnType<typeof snapshot> | null;
    setManualClock(manual: boolean): void;
    /** Advance game time; returns the number of fixed steps executed. */
    advance(ms: number): number;
    spawnEnemy(kind: EnemyKind, x: number, y: number): number;
    perf(): ReturnType<GameSession['frameStats']['summary']> | null;
    renderStats(): ReturnType<GameSession['renderStats']>;
  };
  mocks: {
    select(id: string): void;
    reset(): void;
    scenario(): string;
    records(): number;
    outbox(): ReturnType<typeof outboxStore.get>;
  };
}

declare global {
  interface Window {
    __pirateBattle?: PirateBattleTestApi;
  }
}

let current: GameSession | null = null;
/** Final snapshot of the last session, so tests can inspect a match after it ended. */
let lastSnapshot: ReturnType<typeof snapshot> | null = null;

function snapshot(session: GameSession) {
  const w = session.sim.world;
  const ship = (s: (typeof w.ships)[number]) => ({
    id: s.id,
    kind: s.kind,
    x: s.pos.x,
    y: s.pos.y,
    angle: s.angle,
    speed: s.speed,
    health: s.health,
    alive: s.alive,
    cooldowns: { ...s.cooldowns },
  });
  return {
    phase: session.phase,
    pauseReason: session.state.get().pauseReason,
    time: w.time,
    step: w.step,
    status: w.status,
    endReason: w.endReason,
    score: w.score,
    kills: { ...w.kills },
    seed: w.seed,
    config: { durationSec: w.config.match.durationSec, spawnIntervalSec: w.config.spawn.intervalSec },
    arena: {
      width: w.arena.width,
      height: w.arena.height,
      islands: w.arena.islands.map((i) => ({ id: i.id, x: i.x, y: i.y, width: i.width, height: i.height })),
    },
    player: ship(w.player),
    enemies: w.ships.filter((s) => s.kind !== 'player').map(ship),
    projectiles: w.projectiles.map((p) => ({ id: p.id, faction: p.faction, x: p.pos.x, y: p.pos.y, vx: p.vel.x, vy: p.vel.y })),
    spawned: { ...w.spawner.spawned },
  };
}

export function installTestHooks(queryClient: QueryClient): void {
  window.__pirateBattle = {
    session: {
      active: () => current !== null,
      state: () => (current ? snapshot(current) : lastSnapshot),
      setManualClock: (manual) => current?.setManualClock(manual),
      advance: (ms) => current?.advanceBy(ms) ?? 0,
      spawnEnemy: (kind, x, y) => current?.debugSpawn(kind, x, y) ?? -1,
      perf: () => current?.frameStats.summary() ?? null,
      renderStats: () => current?.renderStats() ?? null,
    },
    mocks: {
      select: (id) => selectScenario(id),
      reset: () => resetNetworkState(queryClient),
      scenario: () => mockScenario.current.id,
      records: () => mockDb.allRecords().length,
      outbox: () => outboxStore.get(),
    },
  };
}

export function registerSession(session: GameSession | null): void {
  if (current && !session) lastSnapshot = snapshot(current);
  if (session) lastSnapshot = null;
  current = session;
}
