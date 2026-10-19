/** Enough for ~6 minutes at 60 FPS (or 3 minutes at 120 FPS). */
const CAPACITY = 21_600;

export interface FrameStatsSummary {
  frames: number;
  avgFps: number;
  avgFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  /** Share of frames slower than 1/60 s + 1 ms tolerance. */
  slowFrameRatio: number;
  maxEntities: number;
  avgEntities: number;
  /** CPU time per frame spent in simulation + scene update + render submission. */
  avgWorkMs: number;
  p95WorkMs: number;
  maxWorkMs: number;
}

/**
 * Allocation-free frame time recorder (preallocated typed arrays), used for
 * the performance report and exposed to the profiling scripts.
 */
export class FrameStats {
  private readonly times = new Float32Array(CAPACITY);
  private readonly entities = new Uint16Array(CAPACITY);
  private readonly work = new Float32Array(CAPACITY);
  private count = 0;

  record(frameMs: number, entityCount: number, workMs: number): void {
    if (frameMs <= 0) return;
    const i = this.count % CAPACITY;
    this.times[i] = frameMs;
    this.entities[i] = Math.min(65535, entityCount);
    this.work[i] = workMs;
    this.count++;
  }

  reset(): void {
    this.count = 0;
  }

  summary(): FrameStatsSummary {
    const n = Math.min(this.count, CAPACITY);
    if (n === 0) {
      return { frames: 0, avgFps: 0, avgFrameMs: 0, p50FrameMs: 0, p95FrameMs: 0, p99FrameMs: 0, maxFrameMs: 0, slowFrameRatio: 0, maxEntities: 0, avgEntities: 0, avgWorkMs: 0, p95WorkMs: 0, maxWorkMs: 0 };
    }
    const sorted = Array.from(this.times.subarray(0, n)).sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(n - 1, Math.floor(p * n))] ?? 0;
    const workSorted = Array.from(this.work.subarray(0, n)).sort((a, b) => a - b);
    let workTotal = 0;
    for (const w of workSorted) workTotal += w;
    let total = 0;
    let slow = 0;
    let maxEntities = 0;
    let entityTotal = 0;
    for (let i = 0; i < n; i++) {
      const t = this.times[i] ?? 0;
      total += t;
      if (t > 1000 / 60 + 1) slow++;
      const e = this.entities[i] ?? 0;
      entityTotal += e;
      if (e > maxEntities) maxEntities = e;
    }
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      frames: n,
      avgFps: round(1000 / (total / n)),
      avgFrameMs: round(total / n),
      p50FrameMs: round(pct(0.5)),
      p95FrameMs: round(pct(0.95)),
      p99FrameMs: round(pct(0.99)),
      maxFrameMs: round(sorted[n - 1] ?? 0),
      slowFrameRatio: round(slow / n),
      maxEntities,
      avgEntities: round(entityTotal / n),
      avgWorkMs: round(workTotal / n),
      p95WorkMs: round(workSorted[Math.min(n - 1, Math.floor(0.95 * n))] ?? 0),
      maxWorkMs: round(workSorted[n - 1] ?? 0),
    };
  }
}
