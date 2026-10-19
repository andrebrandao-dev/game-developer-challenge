/**
 * Central, typed gameplay configuration.
 *
 * Every balancing number used by the simulation lives here. Systems receive a
 * frozen snapshot of this object when a match starts, so tuning the game never
 * requires touching system code, and option changes made mid-match only apply
 * to the next match.
 */

export type EnemyKind = 'chaser' | 'shooter';
export type ShipKind = 'player' | EnemyKind;

export interface ShipStats {
  readonly maxHealth: number;
  /** Half-width of the hull capsule, in world units. */
  readonly hullRadius: number;
  /** Distance from the ship centre to the bow/stern capsule end points. */
  readonly hullHalfLength: number;
  /** Units per second. */
  readonly maxSpeed: number;
  /** Units per second². */
  readonly acceleration: number;
  /** Units per second², applied when no thrust is requested. */
  readonly deceleration: number;
  /** Radians per second. */
  readonly turnRate: number;
}

export interface WeaponConfig {
  readonly damage: number;
  /** Units per second. */
  readonly projectileSpeed: number;
  /** Maximum travelled distance before the projectile expires. */
  readonly range: number;
  /** Hard lifetime cap in seconds (safety net in addition to range). */
  readonly lifetimeSec: number;
  readonly cooldownSec: number;
  readonly projectileRadius: number;
}

export interface BroadsideConfig extends WeaponConfig {
  /** Number of parallel projectiles fired per side. */
  readonly count: number;
  /** Spacing between the parallel projectiles along the hull. */
  readonly spacing: number;
}

export interface PlayerConfig extends ShipStats {
  readonly frontCannon: WeaponConfig;
  readonly broadside: BroadsideConfig;
}

export interface ChaserConfig extends ShipStats {
  /** Damage dealt to the player when the chaser rams it (and explodes). */
  readonly contactDamage: number;
}

export interface ShooterConfig extends ShipStats {
  readonly cannon: WeaponConfig;
  /** Distance at which the shooter starts firing. */
  readonly attackRange: number;
  /** Distance the shooter tries to keep from the player. */
  readonly preferredRange: number;
  /** Max angle (radians) between heading and target for the shooter to fire. */
  readonly aimTolerance: number;
}

export interface SpawnConfig {
  readonly intervalSec: number;
  /** Delay before the very first spawn of a match. */
  readonly initialDelaySec: number;
  readonly maxActiveEnemies: number;
  /** Spawn points closer than this to the player are rejected. */
  readonly minDistanceFromPlayer: number;
  /** Free radius required around a spawn point (islands, other ships). */
  readonly clearance: number;
  /** Candidate points tried per spawn before deferring to the next tick. */
  readonly maxAttempts: number;
  /** Delay before retrying when no valid spawn point was found. */
  readonly retryDelaySec: number;
  /** Width of the band along the arena border where enemies appear. */
  readonly edgeBand: number;
  /** Relative spawn weights per enemy type (shuffle-bag distribution). */
  readonly weights: Readonly<Record<EnemyKind, number>>;
}

export interface AiConfig {
  /** Length of the obstacle-avoidance look-ahead ray. */
  readonly lookAhead: number;
  /** Seconds an avoidance side choice is kept, to prevent oscillation. */
  readonly avoidCommitSec: number;
}

export interface ArenaConfig {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
}

export interface SimulationConfig {
  /** Fixed simulation step in seconds. */
  readonly fixedStepSec: number;
  /** Max steps per rendered frame (prevents the spiral of death). */
  readonly maxStepsPerFrame: number;
}

export interface GameConfig {
  readonly arena: ArenaConfig;
  readonly simulation: SimulationConfig;
  readonly match: {
    readonly durationSec: number;
    readonly pointsPerKill: number;
  };
  readonly spawn: SpawnConfig;
  readonly ai: AiConfig;
  readonly player: PlayerConfig;
  readonly chaser: ChaserConfig;
  readonly shooter: ShooterConfig;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  arena: { width: 1920, height: 1080, tileSize: 64 },
  simulation: { fixedStepSec: 1 / 60, maxStepsPerFrame: 5 },
  match: { durationSec: 120, pointsPerKill: 1 },
  spawn: {
    intervalSec: 3,
    initialDelaySec: 1.5,
    maxActiveEnemies: 10,
    minDistanceFromPlayer: 560,
    clearance: 90,
    maxAttempts: 24,
    retryDelaySec: 0.25,
    edgeBand: 110,
    weights: { chaser: 1, shooter: 1 },
  },
  ai: { lookAhead: 170, avoidCommitSec: 0.6 },
  player: {
    maxHealth: 100,
    hullRadius: 24,
    hullHalfLength: 28,
    maxSpeed: 210,
    acceleration: 260,
    deceleration: 180,
    turnRate: 2.6,
    frontCannon: {
      damage: 34,
      projectileSpeed: 620,
      range: 560,
      lifetimeSec: 1.5,
      cooldownSec: 0.45,
      projectileRadius: 5,
    },
    broadside: {
      damage: 25,
      projectileSpeed: 520,
      range: 420,
      lifetimeSec: 1.4,
      cooldownSec: 1.6,
      projectileRadius: 5,
      count: 3,
      spacing: 26,
    },
  },
  chaser: {
    maxHealth: 50,
    hullRadius: 22,
    hullHalfLength: 26,
    maxSpeed: 165,
    acceleration: 220,
    deceleration: 200,
    turnRate: 2.1,
    contactDamage: 20,
  },
  shooter: {
    maxHealth: 75,
    hullRadius: 24,
    hullHalfLength: 28,
    maxSpeed: 115,
    acceleration: 160,
    deceleration: 200,
    turnRate: 1.7,
    cannon: {
      damage: 10,
      projectileSpeed: 430,
      range: 520,
      lifetimeSec: 1.6,
      cooldownSec: 2.2,
      projectileRadius: 5,
    },
    attackRange: 480,
    preferredRange: 300,
    aimTolerance: 0.2,
  },
};

/** Limits for the values players can change in the Options screen. */
export const OPTION_LIMITS = {
  sessionDurationSec: { min: 60, max: 180, step: 10, default: 120 },
  spawnIntervalSec: { min: 0.5, max: 10, step: 0.5, default: 3 },
} as const;

export interface PlayerOptions {
  readonly sessionDurationSec: number;
  readonly spawnIntervalSec: number;
}

export const DEFAULT_PLAYER_OPTIONS: PlayerOptions = {
  sessionDurationSec: OPTION_LIMITS.sessionDurationSec.default,
  spawnIntervalSec: OPTION_LIMITS.spawnIntervalSec.default,
};

type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };

function deepFreeze<T extends object>(value: T): DeepReadonly<T> {
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
}

/**
 * Builds the immutable configuration snapshot used by a single match:
 * base balancing values merged with the player's options.
 */
export function createMatchConfig(
  options: PlayerOptions,
  base: GameConfig = DEFAULT_GAME_CONFIG,
): GameConfig {
  const snapshot: GameConfig = structuredClone({
    ...base,
    match: { ...base.match, durationSec: options.sessionDurationSec },
    spawn: { ...base.spawn, intervalSec: options.spawnIntervalSec },
  });
  return deepFreeze(snapshot);
}
