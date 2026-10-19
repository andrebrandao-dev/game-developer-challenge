import type { GameConfig } from '@/config/gameConfig';
import type { ArenaLayout } from './arena';
import { chaserHelm, shooterHelm } from './systems/ai';
import { hullContact, resolveShipVsStatic } from './systems/collisions';
import { damageShip, destroyShip, fireBroadside, fireFront, tickCooldowns, updateProjectiles } from './systems/combat';
import { steerShip, type Helm } from './systems/movement';
import { updateSpawner } from './systems/spawner';
import { IDLE_INTENT, type ControlIntent, type EndReason, type GameEvent, type MatchResult, type Ship } from './types';
import { createWorld, type World } from './world';

/** Lightweight snapshot for the UI layer (HUD, accessibility). */
export interface HudSnapshot {
  score: number;
  health: number;
  maxHealth: number;
  timeRemainingMs: number;
  elapsedMs: number;
  status: World['status'];
  endReason: EndReason | null;
  enemies: number;
}

/**
 * Deterministic, frame-rate independent match simulation.
 *
 * The simulation knows nothing about rendering, input devices or React: it
 * advances in fixed steps from a `ControlIntent` and records `GameEvent`s.
 * Given the same seed, config and intents, it always produces the same match.
 */
export class Simulation {
  readonly world: World;
  private accumulator = 0;

  constructor(config: GameConfig, seed: number, layout?: ArenaLayout) {
    this.world = createWorld(config, seed, layout);
  }

  get fixedStep(): number {
    return this.world.config.simulation.fixedStepSec;
  }

  /** Fraction of a step left in the accumulator, for render interpolation. */
  get alpha(): number {
    return this.accumulator / this.fixedStep;
  }

  get isRunning(): boolean {
    return this.world.status === 'running';
  }

  /**
   * Feeds real elapsed time (seconds) and runs as many fixed steps as fit.
   * Returns the number of steps executed. Excess time beyond the per-frame
   * cap is dropped, so a stalled tab cannot fast-forward the match.
   */
  advance(elapsedSec: number, intent: ControlIntent): number {
    const step = this.fixedStep;
    const maxSteps = this.world.config.simulation.maxStepsPerFrame;
    this.accumulator += Math.max(0, elapsedSec);
    // Tolerance absorbs float drift (e.g. 144 × 1/144 summing to 0.9999…).
    const threshold = step - 1e-9;
    let steps = 0;
    while (this.accumulator >= threshold && steps < maxSteps) {
      this.step(intent);
      this.accumulator = Math.max(0, this.accumulator - step);
      steps++;
    }
    if (steps === maxSteps && this.accumulator >= threshold) this.accumulator = 0;
    return steps;
  }

  /** Clears pending fractional time (used when resuming from pause). */
  resetAccumulator(): void {
    this.accumulator = 0;
  }

  /** Advances exactly one fixed step. */
  step(intent: ControlIntent = IDLE_INTENT): void {
    const w = this.world;
    if (w.status !== 'running') return;
    const dt = this.fixedStep;

    for (const ship of w.ships) {
      ship.prevPos.x = ship.pos.x;
      ship.prevPos.y = ship.pos.y;
      ship.prevAngle = ship.angle;
    }

    w.step++;
    w.time += dt;
    if (w.time >= w.config.match.durationSec - 1e-9) {
      w.time = w.config.match.durationSec;
      this.end('time_up');
      return;
    }

    for (const ship of w.ships) tickCooldowns(ship, dt);

    this.updatePlayer(intent, dt);
    this.updateEnemies(dt);
    this.resolveShipContacts();
    if (w.status === 'running') updateProjectiles(w, dt);

    w.ships = w.ships.filter((s) => s.alive || s.kind === 'player');
    if (!w.player.alive) {
      this.end('destroyed');
      return;
    }
    updateSpawner(w, dt);
  }

  private updatePlayer(intent: ControlIntent, dt: number): void {
    const w = this.world;
    const player = w.player;
    steerShip(player, { throttle: intent.forward ? 1 : 0, turn: intent.turn }, dt);
    this.trackObstacleContact(player);
    if (intent.fireFront) fireFront(w, player, w.config.player.frontCannon);
    if (intent.fireLeft) fireBroadside(w, player, w.config.player.broadside, 'left');
    if (intent.fireRight) fireBroadside(w, player, w.config.player.broadside, 'right');
  }

  private updateEnemies(dt: number): void {
    const w = this.world;
    for (const ship of w.ships) {
      if (ship.kind === 'player' || !ship.alive) continue;
      const helm: Helm = ship.kind === 'chaser' ? chaserHelm(w, ship, dt) : shooterHelm(w, ship, dt);
      steerShip(ship, helm, dt);
      this.trackObstacleContact(ship);
    }
  }

  private trackObstacleContact(ship: Ship): void {
    const touching = resolveShipVsStatic(this.world, ship);
    if (touching && !ship.touchingObstacle) {
      this.world.events.push({ type: 'collision', shipId: ship.id, x: ship.pos.x, y: ship.pos.y });
    }
    ship.touchingObstacle = touching;
  }

  /** Ship-vs-ship: chasers ram the player; everything else is separated. */
  private resolveShipContacts(): void {
    const w = this.world;
    const ships = w.ships;
    for (let i = 0; i < ships.length; i++) {
      const a = ships[i];
      if (!a?.alive) continue;
      for (let j = i + 1; j < ships.length; j++) {
        const b = ships[j];
        if (!b?.alive || !a.alive) continue;
        const contact = hullContact(a, b);
        if (!contact) continue;

        const chaser = a.kind === 'chaser' && b.kind === 'player' ? a : b.kind === 'chaser' && a.kind === 'player' ? b : null;
        if (chaser) {
          w.events.push({ type: 'shipRammed', shipId: chaser.id, x: contact.point.x, y: contact.point.y });
          destroyShip(w, chaser, 'ram');
          damageShip(w, w.player, w.config.chaser.contactDamage, 'ram', 'enemy');
          continue;
        }

        const half = contact.overlap / 2;
        a.pos.x += contact.nx * half;
        a.pos.y += contact.ny * half;
        b.pos.x -= contact.nx * half;
        b.pos.y -= contact.ny * half;
        // Separation must never push a hull into an island or off the arena.
        resolveShipVsStatic(w, a);
        resolveShipVsStatic(w, b);
      }
    }
  }

  private end(reason: EndReason): void {
    const w = this.world;
    if (w.status !== 'running') return;
    w.status = 'ended';
    w.endReason = reason;
    for (const ship of w.ships) ship.speed = 0;
    w.events.push({ type: 'matchEnded', reason });
  }

  /** Returns and clears events produced since the last call. */
  drainEvents(): GameEvent[] {
    const events = this.world.events;
    this.world.events = [];
    return events;
  }

  hud(): HudSnapshot {
    const w = this.world;
    const durationMs = w.config.match.durationSec * 1000;
    const elapsedMs = Math.min(durationMs, Math.round(w.time * 1000));
    return {
      score: w.score,
      health: w.player.health,
      maxHealth: w.player.stats.maxHealth,
      timeRemainingMs: durationMs - elapsedMs,
      elapsedMs,
      status: w.status,
      endReason: w.endReason,
      enemies: w.ships.length - 1,
    };
  }

  result(): MatchResult | null {
    const w = this.world;
    if (w.status !== 'ended' || !w.endReason) return null;
    return {
      score: w.score,
      durationMs: Math.round(w.time * 1000),
      reason: w.endReason,
      kills: { ...w.kills },
    };
  }
}
