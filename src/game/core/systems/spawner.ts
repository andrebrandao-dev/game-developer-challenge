import type { EnemyKind } from '@/config/gameConfig';
import { circleVsRoundedRect } from '../geometry';
import { angleTo, distance, type Vec2 } from '../math';
import { createShip, type World } from '../world';

const ENEMY_KINDS: readonly EnemyKind[] = ['chaser', 'shooter'];

/**
 * Shuffle bag: each refill contains every enemy kind proportionally to its
 * (integer) weight, so the configured distribution is honoured over short
 * windows and both kinds are guaranteed to show up early in a match.
 */
function nextKind(world: World): EnemyKind {
  const { spawner, rng, config } = world;
  if (spawner.bag.length === 0) {
    for (const kind of ENEMY_KINDS) {
      const count = Math.max(0, Math.round(config.spawn.weights[kind]));
      for (let i = 0; i < count; i++) spawner.bag.push(kind);
    }
    if (spawner.bag.length === 0) spawner.bag.push(...ENEMY_KINDS);
    rng.shuffle(spawner.bag);
  }
  const kind = spawner.bag.pop();
  if (kind === undefined) throw new Error('spawn bag unexpectedly empty');
  return kind;
}

/** Random point inside the band along the arena border. */
function edgePoint(world: World): Vec2 {
  const { rng, arena, config } = world;
  const band = config.spawn.edgeBand;
  const margin = config.spawn.clearance * 0.6;
  const side = rng.int(0, 3);
  const along = (len: number) => rng.range(margin, len - margin);
  const across = () => rng.range(margin, Math.max(margin, band));
  switch (side) {
    case 0:
      return { x: along(arena.width), y: across() };
    case 1:
      return { x: arena.width - across(), y: along(arena.height) };
    case 2:
      return { x: along(arena.width), y: arena.height - across() };
    default:
      return { x: across(), y: along(arena.height) };
  }
}

export function isValidSpawnPoint(world: World, p: Vec2): boolean {
  const { config, arena } = world;
  const clearance = config.spawn.clearance;
  if (distance(p, world.player.pos) < config.spawn.minDistanceFromPlayer) return false;
  for (const island of arena.islands) {
    if (circleVsRoundedRect(p, clearance, island)) return false;
  }
  for (const ship of world.ships) {
    if (ship.alive && distance(p, ship.pos) < clearance * 2) return false;
  }
  return true;
}

export function findSpawnPoint(world: World): Vec2 | null {
  for (let i = 0; i < world.config.spawn.maxAttempts; i++) {
    const p = edgePoint(world);
    if (isValidSpawnPoint(world, p)) return p;
  }
  return null;
}

export function spawnEnemy(world: World, kind: EnemyKind, pos: Vec2): void {
  // Spawn facing the arena centre so new ships sail into the action.
  const centre = { x: world.arena.width / 2, y: world.arena.height / 2 };
  const ship = createShip(world, kind, pos, angleTo(pos, centre));
  world.ships.push(ship);
  world.spawner.spawned[kind] += 1;
  world.events.push({ type: 'shipSpawned', shipId: ship.id, kind, x: pos.x, y: pos.y });
}

/**
 * Spawns one enemy every `intervalSec` of active play. When the arena is at
 * its cap the slot is skipped; when no safe point is found the attempt is
 * retried shortly after instead of spawning somewhere unfair.
 */
export function updateSpawner(world: World, dt: number): void {
  const { spawner, config } = world;
  spawner.timer -= dt;
  if (spawner.timer > 0) return;

  const activeEnemies = world.ships.length - 1;
  if (activeEnemies >= config.spawn.maxActiveEnemies) {
    spawner.timer += config.spawn.intervalSec;
    return;
  }
  const point = findSpawnPoint(world);
  if (!point) {
    spawner.timer = config.spawn.retryDelaySec;
    return;
  }
  spawnEnemy(world, nextKind(world), point);
  spawner.timer += config.spawn.intervalSec;
  // Never let a long stall queue up a burst of spawns.
  if (spawner.timer < 0) spawner.timer = config.spawn.intervalSec;
}
