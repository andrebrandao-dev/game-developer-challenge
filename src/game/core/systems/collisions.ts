import { circleVsRoundedRect, type RoundedRect } from '../geometry';
import { closestPointOnSegment, closestPointsBetweenSegments, type Vec2 } from '../math';
import type { Ship } from '../types';
import { hullSegment, type World } from '../world';

const RESOLVE_ITERATIONS = 3;
/** Fraction of speed kept when hitting an obstacle head-on. */
const HEAD_ON_SPEED_KEEP = 0.1;

/** Hull sample points (bow, centre, stern) used against static obstacles. */
function hullSamples(ship: Ship): Vec2[] {
  const { bow, stern } = hullSegment(ship);
  return [bow, ship.pos, stern];
}

/**
 * Pushes a ship out of islands and keeps its hull inside the arena.
 * Speed is reduced according to how head-on the impact was, so ships slide
 * along coastlines instead of sticking to them.
 */
export function resolveShipVsStatic(world: World, ship: Ship): boolean {
  const { arena } = world;
  const r = ship.stats.hullRadius;
  let touched = false;
  let impactX = 0;
  let impactY = 0;

  for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
    let pushX = 0;
    let pushY = 0;
    let pushDepth = 0;

    for (const p of hullSamples(ship)) {
      for (const island of arena.islands) {
        const pen = circleVsRoundedRect(p, r, island);
        if (pen && pen.depth > pushDepth) {
          pushDepth = pen.depth;
          pushX = pen.normalX;
          pushY = pen.normalY;
        }
      }
      // Arena edges behave like walls.
      const edges: [number, number, number][] = [
        [r - p.x, 1, 0],
        [p.x - (arena.width - r), -1, 0],
        [r - p.y, 0, 1],
        [p.y - (arena.height - r), 0, -1],
      ];
      for (const [depth, nx, ny] of edges) {
        if (depth > pushDepth) {
          pushDepth = depth;
          pushX = nx;
          pushY = ny;
        }
      }
    }

    if (pushDepth <= 0) break;
    ship.pos.x += pushX * pushDepth;
    ship.pos.y += pushY * pushDepth;
    impactX = pushX;
    impactY = pushY;
    touched = true;
  }

  if (touched) {
    const headOn = Math.abs(Math.cos(ship.angle) * impactX + Math.sin(ship.angle) * impactY);
    ship.speed *= 1 - headOn * (1 - HEAD_ON_SPEED_KEEP);
  }
  return touched;
}

/** Closest distance information between two ship hull capsules. */
export function hullContact(a: Ship, b: Ship): { overlap: number; nx: number; ny: number; point: Vec2 } | null {
  const ha = hullSegment(a);
  const hb = hullSegment(b);
  const { a: pa, b: pb, distSq } = closestPointsBetweenSegments(ha.bow, ha.stern, hb.bow, hb.stern);
  const reach = a.stats.hullRadius + b.stats.hullRadius;
  if (distSq >= reach * reach) return null;
  const dist = Math.sqrt(distSq);
  // Degenerate overlap: fall back to the centre-to-centre axis.
  let nx = dist > 1e-6 ? (pa.x - pb.x) / dist : a.pos.x - b.pos.x;
  let ny = dist > 1e-6 ? (pa.y - pb.y) / dist : a.pos.y - b.pos.y;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  return {
    overlap: reach - dist,
    nx,
    ny,
    point: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
  };
}

/** Distance from a point to a ship hull surface (negative when inside). */
export function pointToHullDistance(p: Vec2, ship: Ship): number {
  const { bow, stern } = hullSegment(ship);
  const c = closestPointOnSegment(p, bow, stern);
  return Math.hypot(p.x - c.x, p.y - c.y) - ship.stats.hullRadius;
}

export function pointHitsIsland(world: World, p: Vec2, radius: number): RoundedRect | null {
  for (const island of world.arena.islands) {
    if (circleVsRoundedRect(p, radius, island)) return island;
  }
  return null;
}
