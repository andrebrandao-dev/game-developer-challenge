import type { EnemyKind, ShipKind, ShipStats } from '@/config/gameConfig';
import type { Vec2 } from './math';

export type Faction = 'player' | 'enemy';
export type WeaponSlot = 'front' | 'left' | 'right';
export type MatchStatus = 'running' | 'ended';
export type EndReason = 'time_up' | 'destroyed';
export type DeathCause = 'projectile' | 'ram';

/** What the player wants to do this step. Produced by the input layer. */
export interface ControlIntent {
  forward: boolean;
  /** -1 = counter-clockwise (left), 1 = clockwise (right). */
  turn: -1 | 0 | 1;
  fireFront: boolean;
  fireLeft: boolean;
  fireRight: boolean;
}

export const IDLE_INTENT: Readonly<ControlIntent> = Object.freeze({
  forward: false,
  turn: 0,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
});

export interface AiState {
  /** Current avoidance side (-1/1) or 0 when the path is clear. */
  avoidSide: -1 | 0 | 1;
  avoidTimer: number;
}

export interface Ship {
  readonly id: number;
  readonly kind: ShipKind;
  readonly faction: Faction;
  readonly stats: ShipStats;
  pos: Vec2;
  /** Position at the start of the last step, used for render interpolation. */
  prevPos: Vec2;
  angle: number;
  prevAngle: number;
  speed: number;
  health: number;
  alive: boolean;
  /** Remaining cooldown (seconds) per weapon slot. */
  cooldowns: Record<WeaponSlot, number>;
  /** Simulation time of the last damage taken (for feedback). */
  lastHitAt: number;
  spawnedAt: number;
  /** True while the hull is pressed against an island or the arena edge. */
  touchingObstacle: boolean;
  ai: AiState;
}

export interface Projectile {
  readonly id: number;
  readonly faction: Faction;
  readonly ownerId: number;
  readonly damage: number;
  readonly radius: number;
  readonly maxRange: number;
  readonly maxAge: number;
  pos: Vec2;
  prevPos: Vec2;
  readonly vel: Vec2;
  travelled: number;
  age: number;
  alive: boolean;
}

/** Discrete things that happened during a step. Consumed by render/audio/UI. */
export type GameEvent =
  | { type: 'matchStarted' }
  | { type: 'shipSpawned'; shipId: number; kind: ShipKind; x: number; y: number }
  | { type: 'shotFired'; shipId: number; slot: WeaponSlot; x: number; y: number; angle: number; count: number }
  | { type: 'shipHit'; shipId: number; kind: ShipKind; damage: number; health: number; x: number; y: number }
  | { type: 'shipDestroyed'; shipId: number; kind: ShipKind; cause: DeathCause; x: number; y: number; angle: number }
  | { type: 'shipRammed'; shipId: number; x: number; y: number }
  | { type: 'projectileExpired'; projectileId: number; x: number; y: number; on: 'water' | 'island' | 'ship' | 'bounds' }
  | { type: 'scoreChanged'; score: number }
  | { type: 'collision'; shipId: number; x: number; y: number }
  | { type: 'matchEnded'; reason: EndReason };

export interface MatchResult {
  readonly score: number;
  /** Effective (active) play time in milliseconds. */
  readonly durationMs: number;
  readonly reason: EndReason;
  readonly kills: Readonly<Record<EnemyKind, number>>;
}
