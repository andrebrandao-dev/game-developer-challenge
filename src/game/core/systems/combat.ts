import type { BroadsideConfig, WeaponConfig } from '@/config/gameConfig';
import type { Vec2 } from '../math';
import type { DeathCause, Projectile, Ship, WeaponSlot } from '../types';
import type { World } from '../world';
import { pointHitsIsland, pointToHullDistance } from './collisions';

/** Max distance a projectile advances between collision checks. */
const PROJECTILE_SUBSTEP = 6;
/** Extra clearance so freshly fired shots start outside the shooter's hull. */
const MUZZLE_CLEARANCE = 8;

export function tickCooldowns(ship: Ship, dt: number): void {
  const c = ship.cooldowns;
  c.front = Math.max(0, c.front - dt);
  c.left = Math.max(0, c.left - dt);
  c.right = Math.max(0, c.right - dt);
}

function spawnProjectile(world: World, owner: Ship, weapon: WeaponConfig, origin: Vec2, angle: number): void {
  const projectile: Projectile = {
    id: world.nextId++,
    faction: owner.faction,
    ownerId: owner.id,
    damage: weapon.damage,
    radius: weapon.projectileRadius,
    maxRange: weapon.range,
    maxAge: weapon.lifetimeSec,
    pos: { x: origin.x, y: origin.y },
    prevPos: { x: origin.x, y: origin.y },
    vel: { x: Math.cos(angle) * weapon.projectileSpeed, y: Math.sin(angle) * weapon.projectileSpeed },
    travelled: 0,
    age: 0,
    alive: true,
  };
  world.projectiles.push(projectile);
}

/** Fires a single shot from the bow. Returns false while on cooldown. */
export function fireFront(world: World, ship: Ship, weapon: WeaponConfig): boolean {
  if (ship.cooldowns.front > 0) return false;
  ship.cooldowns.front = weapon.cooldownSec;
  const reach = ship.stats.hullHalfLength + ship.stats.hullRadius + MUZZLE_CLEARANCE;
  const origin = { x: ship.pos.x + Math.cos(ship.angle) * reach, y: ship.pos.y + Math.sin(ship.angle) * reach };
  spawnProjectile(world, ship, weapon, origin, ship.angle);
  world.events.push({ type: 'shotFired', shipId: ship.id, slot: 'front', x: origin.x, y: origin.y, angle: ship.angle, count: 1 });
  return true;
}

/** Fires `count` parallel shots perpendicular to the hull on one side. */
export function fireBroadside(world: World, ship: Ship, weapon: BroadsideConfig, side: 'left' | 'right'): boolean {
  const slot: WeaponSlot = side;
  if (ship.cooldowns[slot] > 0) return false;
  ship.cooldowns[slot] = weapon.cooldownSec;

  // Screen space is y-down, so "left" of the heading is -90°.
  const angle = ship.angle + (side === 'left' ? -Math.PI / 2 : Math.PI / 2);
  const fx = Math.cos(ship.angle);
  const fy = Math.sin(ship.angle);
  const sx = Math.cos(angle);
  const sy = Math.sin(angle);
  const out = ship.stats.hullRadius + MUZZLE_CLEARANCE;

  for (let i = 0; i < weapon.count; i++) {
    const along = (i - (weapon.count - 1) / 2) * weapon.spacing;
    const origin = { x: ship.pos.x + fx * along + sx * out, y: ship.pos.y + fy * along + sy * out };
    spawnProjectile(world, ship, weapon, origin, angle);
  }
  world.events.push({
    type: 'shotFired',
    shipId: ship.id,
    slot,
    x: ship.pos.x + sx * out,
    y: ship.pos.y + sy * out,
    angle,
    count: weapon.count,
  });
  return true;
}

/**
 * Applies damage to a ship. Handles destruction and scoring.
 * Returns true if the ship was destroyed by this hit.
 */
export function damageShip(world: World, target: Ship, amount: number, cause: DeathCause, byFaction: 'player' | 'enemy'): boolean {
  if (!target.alive || world.status !== 'running') return false;
  target.health = Math.max(0, target.health - amount);
  target.lastHitAt = world.time;
  world.events.push({
    type: 'shipHit',
    shipId: target.id,
    kind: target.kind,
    damage: amount,
    health: target.health,
    x: target.pos.x,
    y: target.pos.y,
  });
  if (target.health > 0) return false;
  destroyShip(world, target, cause);
  // Only the player's own shots score, and never after the player has sunk
  // (a shot still in flight during the losing step must not count).
  if (target.kind !== 'player' && byFaction === 'player' && cause === 'projectile' && world.player.alive) {
    world.score += world.config.match.pointsPerKill;
    world.kills[target.kind] += 1;
    world.events.push({ type: 'scoreChanged', score: world.score });
  }
  return true;
}

export function destroyShip(world: World, ship: Ship, cause: DeathCause): void {
  if (!ship.alive) return;
  ship.alive = false;
  ship.speed = 0;
  world.events.push({
    type: 'shipDestroyed',
    shipId: ship.id,
    kind: ship.kind,
    cause,
    x: ship.pos.x,
    y: ship.pos.y,
    angle: ship.angle,
  });
  // A destroyed enemy stops causing damage: its shots still in flight fizzle out.
  if (ship.faction === 'enemy') {
    for (const p of world.projectiles) {
      if (p.alive && p.ownerId === ship.id) expire(world, p, 'water');
    }
  }
}

/**
 * Advances projectiles with sub-stepping so fast shots cannot tunnel through
 * hulls or coastlines. Each projectile hits at most one target and is then
 * removed, so damage is applied exactly once.
 */
export function updateProjectiles(world: World, dt: number): void {
  const { arena } = world;
  for (const p of world.projectiles) {
    if (!p.alive) continue;
    p.prevPos.x = p.pos.x;
    p.prevPos.y = p.pos.y;
    p.age += dt;

    const stepX = p.vel.x * dt;
    const stepY = p.vel.y * dt;
    const stepLen = Math.hypot(stepX, stepY);
    const remainingRange = p.maxRange - p.travelled;
    const travel = Math.min(stepLen, Math.max(0, remainingRange));
    const substeps = Math.max(1, Math.ceil(travel / PROJECTILE_SUBSTEP));
    const ux = stepLen > 0 ? stepX / stepLen : 0;
    const uy = stepLen > 0 ? stepY / stepLen : 0;

    for (let i = 1; i <= substeps && p.alive; i++) {
      const d = (travel * i) / substeps;
      p.pos.x = p.prevPos.x + ux * d;
      p.pos.y = p.prevPos.y + uy * d;

      if (p.pos.x < 0 || p.pos.y < 0 || p.pos.x > arena.width || p.pos.y > arena.height) {
        expire(world, p, 'bounds');
        break;
      }
      if (pointHitsIsland(world, p.pos, p.radius)) {
        expire(world, p, 'island');
        break;
      }
      for (const ship of world.ships) {
        if (!ship.alive || ship.faction === p.faction) continue;
        if (pointToHullDistance(p.pos, ship) <= p.radius) {
          expire(world, p, 'ship');
          damageShip(world, ship, p.damage, 'projectile', p.faction);
          break;
        }
      }
    }
    if (!p.alive) continue;

    p.travelled += travel;
    if (p.travelled >= p.maxRange - 1e-6 || p.age >= p.maxAge) expire(world, p, 'water');
  }
  world.projectiles = world.projectiles.filter((p) => p.alive);
}

function expire(world: World, p: Projectile, on: 'water' | 'island' | 'ship' | 'bounds'): void {
  p.alive = false;
  world.events.push({ type: 'projectileExpired', projectileId: p.id, x: p.pos.x, y: p.pos.y, on });
}
