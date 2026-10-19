import { clamp } from '../math';
import type { Ship } from '../types';

/** Normalised steering command shared by player input and AI. */
export interface Helm {
  /** 0..1 fraction of max speed requested. */
  throttle: number;
  /** -1..1 fraction of the turn rate (positive = clockwise). */
  turn: number;
}

/**
 * Applies a helm command to a ship for `dt` seconds. Ships only move forward:
 * thrust accelerates up to `throttle × maxSpeed`, otherwise they coast down.
 */
export function steerShip(ship: Ship, helm: Helm, dt: number): void {
  const { stats } = ship;
  ship.angle += clamp(helm.turn, -1, 1) * stats.turnRate * dt;

  const target = clamp(helm.throttle, 0, 1) * stats.maxSpeed;
  if (ship.speed < target) {
    ship.speed = Math.min(target, ship.speed + stats.acceleration * dt);
  } else if (ship.speed > target) {
    ship.speed = Math.max(target, ship.speed - stats.deceleration * dt);
  }

  ship.pos.x += Math.cos(ship.angle) * ship.speed * dt;
  ship.pos.y += Math.sin(ship.angle) * ship.speed * dt;
}
