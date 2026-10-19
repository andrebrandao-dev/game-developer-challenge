import type { EnemyKind, GameConfig, ShipKind, ShipStats } from '@/config/gameConfig';
import { buildArena, type Arena, type ArenaLayout } from './arena';
import type { Vec2 } from './math';
import { Rng } from './rng';
import type { EndReason, Faction, GameEvent, MatchStatus, Projectile, Ship } from './types';

export interface SpawnerState {
  /** Seconds until the next spawn attempt. */
  timer: number;
  /** Shuffle bag of upcoming enemy kinds. */
  bag: EnemyKind[];
  spawned: Record<EnemyKind, number>;
}

/** Complete mutable state of one match. Owned by the Simulation. */
export interface World {
  readonly config: GameConfig;
  readonly arena: Arena;
  readonly rng: Rng;
  readonly seed: number;
  /** Simulated, active play time in seconds. */
  time: number;
  step: number;
  status: MatchStatus;
  endReason: EndReason | null;
  score: number;
  kills: Record<EnemyKind, number>;
  readonly player: Ship;
  /** All ships alive, player first. Destroyed ships are removed. */
  ships: Ship[];
  projectiles: Projectile[];
  spawner: SpawnerState;
  /** Events produced since the last drain. */
  events: GameEvent[];
  nextId: number;
}

export function statsFor(config: GameConfig, kind: ShipKind): ShipStats {
  switch (kind) {
    case 'player':
      return config.player;
    case 'chaser':
      return config.chaser;
    case 'shooter':
      return config.shooter;
  }
}

export function createShip(world: Pick<World, 'config' | 'time'> & { nextId: number }, kind: ShipKind, pos: Vec2, angle: number): Ship {
  const stats = statsFor(world.config, kind);
  const faction: Faction = kind === 'player' ? 'player' : 'enemy';
  return {
    id: world.nextId++,
    kind,
    faction,
    stats,
    pos: { x: pos.x, y: pos.y },
    prevPos: { x: pos.x, y: pos.y },
    angle,
    prevAngle: angle,
    speed: 0,
    health: stats.maxHealth,
    alive: true,
    cooldowns: { front: 0, left: 0, right: 0 },
    lastHitAt: Number.NEGATIVE_INFINITY,
    spawnedAt: world.time,
    touchingObstacle: false,
    ai: { avoidSide: 0, avoidTimer: 0 },
  };
}

export function createWorld(config: GameConfig, seed: number, layout?: ArenaLayout): World {
  const arena = buildArena(config.arena, layout);
  const idSource = { config, time: 0, nextId: 1 };
  const player = createShip(idSource, 'player', arena.playerStart, arena.playerHeading);
  return {
    config,
    arena,
    rng: new Rng(seed),
    seed,
    time: 0,
    step: 0,
    status: 'running',
    endReason: null,
    score: 0,
    kills: { chaser: 0, shooter: 0 },
    player,
    ships: [player],
    projectiles: [],
    spawner: {
      timer: config.spawn.initialDelaySec,
      bag: [],
      spawned: { chaser: 0, shooter: 0 },
    },
    events: [{ type: 'matchStarted' }],
    nextId: idSource.nextId,
  };
}

/** Forward unit vector for a ship heading. */
export const shipForward = (ship: Ship): Vec2 => ({ x: Math.cos(ship.angle), y: Math.sin(ship.angle) });

/** End points of the hull capsule (bow, stern). */
export function hullSegment(ship: Ship): { bow: Vec2; stern: Vec2 } {
  const fx = Math.cos(ship.angle) * ship.stats.hullHalfLength;
  const fy = Math.sin(ship.angle) * ship.stats.hullHalfLength;
  return {
    bow: { x: ship.pos.x + fx, y: ship.pos.y + fy },
    stern: { x: ship.pos.x - fx, y: ship.pos.y - fy },
  };
}
