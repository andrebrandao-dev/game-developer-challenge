import { clamp, type Vec2 } from './math';

/** Axis-aligned rectangle with rounded corners (world units). */
export interface RoundedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly cornerRadius: number;
}

export interface Penetration {
  /** Unit vector pointing out of the obstacle. */
  normalX: number;
  normalY: number;
  depth: number;
}

/**
 * Signed-distance style query: returns how far a circle at `p` with radius `r`
 * penetrates a rounded rectangle, or null when they do not overlap.
 *
 * A rounded rect is the Minkowski sum of its "core" rect (shrunk by the corner
 * radius) and a circle, so the test reduces to point-vs-core-rect with the
 * radii added together.
 */
export function circleVsRoundedRect(p: Vec2, r: number, rect: RoundedRect): Penetration | null {
  const cr = rect.cornerRadius;
  const minX = rect.x + cr;
  const minY = rect.y + cr;
  const maxX = rect.x + rect.width - cr;
  const maxY = rect.y + rect.height - cr;
  const reach = r + cr;

  const cx = clamp(p.x, minX, maxX);
  const cy = clamp(p.y, minY, maxY);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const distSq = dx * dx + dy * dy;

  if (distSq > 0) {
    if (distSq >= reach * reach) return null;
    const dist = Math.sqrt(distSq);
    return { normalX: dx / dist, normalY: dy / dist, depth: reach - dist };
  }

  // Centre is inside the core rect: push out through the nearest face.
  const left = p.x - minX;
  const right = maxX - p.x;
  const top = p.y - minY;
  const bottom = maxY - p.y;
  const min = Math.min(left, right, top, bottom);
  if (min === left) return { normalX: -1, normalY: 0, depth: left + reach };
  if (min === right) return { normalX: 1, normalY: 0, depth: right + reach };
  if (min === top) return { normalX: 0, normalY: -1, depth: top + reach };
  return { normalX: 0, normalY: 1, depth: bottom + reach };
}

export const pointInRoundedRect = (p: Vec2, rect: RoundedRect, padding = 0): boolean =>
  circleVsRoundedRect(p, padding, rect) !== null;

/**
 * Returns the parametric distance t∈[0,1] at which segment a→b (swept with
 * radius r) first touches the rounded rect, or null. Uses conservative
 * sub-stepping, which is plenty for the short rays the AI and projectiles use.
 */
export function sweepCircleVsRoundedRect(
  a: Vec2,
  b: Vec2,
  r: number,
  rect: RoundedRect,
  stepLength = 8,
): number | null {
  // Fast reject with the segment's bounding box.
  const pad = r;
  if (
    Math.max(a.x, b.x) < rect.x - pad ||
    Math.min(a.x, b.x) > rect.x + rect.width + pad ||
    Math.max(a.y, b.y) < rect.y - pad ||
    Math.min(a.y, b.y) > rect.y + rect.height + pad
  ) {
    return null;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / stepLength));
  const p = { x: a.x, y: a.y };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    p.x = a.x + dx * t;
    p.y = a.y + dy * t;
    if (circleVsRoundedRect(p, r, rect)) return t;
  }
  return null;
}
