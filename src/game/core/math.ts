export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wraps an angle to the (-π, π] range. */
export function wrapAngle(angle: number): number {
  let a = angle % TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Signed shortest difference `to - from`, in (-π, π]. */
export const angleDelta = (from: number, to: number): number => wrapAngle(to - from);

/** Interpolates angles along the shortest arc. */
export const lerpAngle = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;

export const distanceSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export const distance = (a: Vec2, b: Vec2): number => Math.sqrt(distanceSq(a, b));

export const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);

/** Unit vector for a heading. Heading 0 points to +x; positive is clockwise on screen (y down). */
export const direction = (angle: number): Vec2 => ({ x: Math.cos(angle), y: Math.sin(angle) });

/** Closest point to `p` on segment `a`-`b`. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return { x: a.x, y: a.y };
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq, 0, 1);
  return { x: a.x + abx * t, y: a.y + aby * t };
}

/**
 * Closest points between segments p1-q1 and p2-q2
 * (Ericson, Real-Time Collision Detection, 5.1.9).
 */
export function closestPointsBetweenSegments(
  p1: Vec2,
  q1: Vec2,
  p2: Vec2,
  q2: Vec2,
): { a: Vec2; b: Vec2; distSq: number } {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const EPS = 1e-9;
  let s: number;
  let t: number;

  if (a <= EPS && e <= EPS) {
    s = 0;
    t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry;
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const ca = { x: p1.x + d1x * s, y: p1.y + d1y * s };
  const cb = { x: p2.x + d2x * t, y: p2.y + d2y * t };
  return { a: ca, b: cb, distSq: distanceSq(ca, cb) };
}
