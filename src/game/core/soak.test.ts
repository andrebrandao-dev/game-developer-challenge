import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '@/config/gameConfig';
import { circleVsRoundedRect } from './geometry';
import { Simulation } from './simulation';
import type { ControlIntent } from './types';

/**
 * Plays a full 3-minute match on the real arena with a scripted pilot and
 * checks the physical invariants on every step.
 */
describe('soak: full match on the default arena', () => {
  it.each([1, 2, 3])('keeps every ship valid for 180 s (seed %i)', (seed) => {
    const config = createMatchConfig({ sessionDurationSec: 180, spawnIntervalSec: 1 });
    const sim = new Simulation({ ...config, player: { ...config.player, maxHealth: 1e9 } }, seed);
    const w = sim.world;
    let spawned = 0;
    let destroyed = 0;

    for (let step = 0; sim.isRunning; step++) {
      const phase = Math.floor(step / 90) % 4;
      const input: ControlIntent = {
        forward: phase !== 3,
        turn: phase === 1 ? 1 : phase === 2 ? -1 : 0,
        fireFront: step % 3 === 0,
        fireLeft: phase === 0,
        fireRight: phase === 2,
      };
      sim.step(input);
      for (const e of sim.drainEvents()) {
        if (e.type === 'shipSpawned') spawned++;
        if (e.type === 'shipDestroyed') destroyed++;
      }

      for (const ship of w.ships) {
        expect(Number.isFinite(ship.pos.x) && Number.isFinite(ship.pos.y)).toBe(true);
        expect(ship.pos.x).toBeGreaterThanOrEqual(0);
        expect(ship.pos.y).toBeGreaterThanOrEqual(0);
        expect(ship.pos.x).toBeLessThanOrEqual(w.arena.width);
        expect(ship.pos.y).toBeLessThanOrEqual(w.arena.height);
        for (const island of w.arena.islands) {
          // Allow a small tolerance for same-step separation pushes.
          const pen = circleVsRoundedRect(ship.pos, ship.stats.hullRadius - 6, island);
          expect(pen, `ship ${ship.kind}#${ship.id} inside ${island.id} at step ${step}`).toBeNull();
        }
      }
    }

    expect(sim.result()?.reason).toBe('time_up');
    expect(spawned).toBeGreaterThan(12);
    expect(destroyed).toBeGreaterThan(0);
  });
});
