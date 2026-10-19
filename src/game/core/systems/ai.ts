import { sweepCircleVsRoundedRect } from '../geometry';
import { angleDelta, angleTo, clamp, distance, type Vec2 } from '../math';
import type { Ship } from '../types';
import type { World } from '../world';
import { fireFront } from './combat';
import type { Helm } from './movement';

/** Candidate heading offsets (radians) tried when the direct path is blocked. */
const AVOID_OFFSETS = [0.35, 0.7, 1.05, 1.4, 1.75, 2.1];
/** Margin added to the hull radius for look-ahead rays. */
const RAY_MARGIN = 10;

/** True when a circle of radius `r` can travel from `from` to `to` without touching land or leaving the arena. */
export function isPathClear(world: World, from: Vec2, to: Vec2, r: number): boolean {
  const { arena } = world;
  if (to.x < r || to.y < r || to.x > arena.width - r || to.y > arena.height - r) return false;
  for (const island of arena.islands) {
    if (sweepCircleVsRoundedRect(from, to, r, island) !== null) return false;
  }
  return true;
}

/** Line of sight for projectiles (thin ray). */
export function hasLineOfSight(world: World, from: Vec2, to: Vec2): boolean {
  for (const island of world.arena.islands) {
    if (sweepCircleVsRoundedRect(from, to, 2, island) !== null) return false;
  }
  return true;
}

function rayEnd(from: Vec2, angle: number, length: number): Vec2 {
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/**
 * Picks a heading towards `target` that avoids islands. The direct heading is
 * preferred; otherwise increasing offsets are tried, starting on the side the
 * ship last committed to so it does not oscillate in front of a coast.
 */
export function chooseHeading(world: World, ship: Ship, target: Vec2, dt: number): { heading: number; blockedAhead: boolean } {
  const { ai } = ship;
  const desired = angleTo(ship.pos, target);
  const r = ship.stats.hullRadius + RAY_MARGIN;
  const look = Math.min(world.config.ai.lookAhead, Math.max(60, distance(ship.pos, target)));

  ai.avoidTimer = Math.max(0, ai.avoidTimer - dt);
  if (ai.avoidTimer === 0) ai.avoidSide = 0;

  const blockedAhead = !isPathClear(world, ship.pos, rayEnd(ship.pos, ship.angle, look * 0.6), r);

  if (ai.avoidSide === 0 && isPathClear(world, ship.pos, rayEnd(ship.pos, desired, look), r)) {
    return { heading: desired, blockedAhead };
  }

  // Prefer the committed side, otherwise the side the ship is already turning towards.
  const preferred: -1 | 1 = ai.avoidSide !== 0 ? ai.avoidSide : angleDelta(ship.angle, desired) >= 0 ? 1 : -1;
  for (const offset of AVOID_OFFSETS) {
    for (const side of [preferred, -preferred as -1 | 1]) {
      const heading = desired + offset * side;
      if (isPathClear(world, ship.pos, rayEnd(ship.pos, heading, look), r)) {
        ai.avoidSide = side;
        ai.avoidTimer = world.config.ai.avoidCommitSec;
        return { heading, blockedAhead };
      }
    }
  }
  // Boxed in: turn hard on the preferred side until something opens up.
  ai.avoidSide = preferred;
  ai.avoidTimer = world.config.ai.avoidCommitSec;
  return { heading: ship.angle + (Math.PI / 2) * preferred, blockedAhead: true };
}

/** Proportional turn command towards a heading. */
function turnTowards(ship: Ship, heading: number): number {
  const error = angleDelta(ship.angle, heading);
  // Full rudder until within ~1/6 s of turning, then ease in.
  return clamp(error / (ship.stats.turnRate / 6), -1, 1);
}

export function chaserHelm(world: World, ship: Ship, dt: number): Helm {
  const { heading, blockedAhead } = chooseHeading(world, ship, world.player.pos, dt);
  return { turn: turnTowards(ship, heading), throttle: blockedAhead ? 0.45 : 1 };
}

/**
 * Shooter: closes in until it reaches its preferred range, then holds position
 * and keeps the bow on the player. Fires when within attack range, aligned and
 * with a clear line of sight.
 */
export function shooterHelm(world: World, ship: Ship, dt: number): Helm {
  const cfg = world.config.shooter;
  const player = world.player;
  const dist = distance(ship.pos, player.pos);
  const aim = angleTo(ship.pos, player.pos);
  let helm: Helm;

  if (dist > cfg.preferredRange) {
    const { heading, blockedAhead } = chooseHeading(world, ship, player.pos, dt);
    const approach = dist < cfg.attackRange ? 0.6 : 1;
    helm = { turn: turnTowards(ship, heading), throttle: blockedAhead ? 0.4 : approach };
  } else {
    helm = { turn: turnTowards(ship, aim), throttle: 0 };
  }

  const aligned = Math.abs(angleDelta(ship.angle, aim)) <= cfg.aimTolerance;
  if (player.alive && dist <= cfg.attackRange && aligned && ship.cooldowns.front === 0) {
    const muzzle = rayEnd(ship.pos, ship.angle, ship.stats.hullHalfLength + ship.stats.hullRadius);
    if (hasLineOfSight(world, muzzle, player.pos)) fireFront(world, ship, cfg.cannon);
  }
  return helm;
}
