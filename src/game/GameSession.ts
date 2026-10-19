import { Application, type Ticker } from 'pixi.js';
import type { EnemyKind, GameConfig } from '@/config/gameConfig';
import { ValueStore } from '@/lib/store';
import type { GameTextures } from './assets/gameAssets';
import { audio } from './audio/AudioManager';
import { SoundDirector } from './audio/SoundDirector';
import type { ArenaLayout } from './core/arena';
import { Simulation, type HudSnapshot } from './core/simulation';
import { spawnEnemy } from './core/systems/spawner';
import type { GameEvent, MatchResult } from './core/types';
import { InputController } from './input/InputController';
import { GameRenderer } from './render/GameRenderer';
import { FrameStats } from './perf/FrameStats';

export type PauseReason = 'manual' | 'focus-lost' | 'hidden' | 'orientation';
export type SessionPhase = 'initialising' | 'running' | 'paused' | 'ended' | 'destroyed';

export interface SessionState {
  phase: SessionPhase;
  pauseReason: PauseReason | null;
}

/** HUD values at display granularity (whole seconds), to limit UI updates. */
export interface HudView {
  score: number;
  health: number;
  maxHealth: number;
  secondsRemaining: number;
  enemies: number;
}

export interface GameSessionOptions {
  readonly config: GameConfig;
  readonly seed: number;
  readonly textures: GameTextures;
  readonly layout?: ArenaLayout;
  /** When true the simulation only advances through `advanceBy` (tests). */
  readonly manualClock?: boolean;
  readonly onEnded: (result: MatchResult) => void;
}

const MAX_RESOLUTION = 2;

/**
 * Owns everything that lives for exactly one match: the simulation, the Pixi
 * application and renderer, input listeners, the game loop and audio loops.
 *
 * React only creates and destroys sessions and subscribes to the `hud` and
 * `state` stores; it never re-renders per frame.
 */
export class GameSession {
  readonly sim: Simulation;
  readonly input = new InputController();
  readonly state = new ValueStore<SessionState>({ phase: 'initialising', pauseReason: null });
  readonly hud: ValueStore<HudView>;
  readonly frameStats = new FrameStats();

  private app: Application | null = null;
  private renderer: GameRenderer | null = null;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private readonly sounds: SoundDirector;
  private destroyed = false;
  private endReported = false;
  private skipNextDelta = false;
  private manualClock: boolean;

  constructor(private readonly options: GameSessionOptions) {
    this.sim = new Simulation(options.config, options.seed, options.layout);
    this.manualClock = options.manualClock ?? false;
    this.sounds = new SoundDirector(this.sim.world.player.id);
    this.hud = new ValueStore<HudView>(this.hudView(this.sim.hud()));
  }

  get phase(): SessionPhase {
    return this.state.get().phase;
  }

  /**
   * Creates the Pixi application inside `container`. Safe to call and then
   * `destroy()` before it resolves (React Strict Mode double effects): the
   * late application is torn down as soon as initialisation finishes.
   */
  async mount(container: HTMLElement): Promise<void> {
    if (this.destroyed || this.app) return;
    const app = new Application();
    await app.init({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      background: '#0b3247',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION),
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
    });
    if (this.destroyed) {
      app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
      return;
    }

    this.app = app;
    this.container = container;
    app.canvas.setAttribute('aria-hidden', 'true');
    app.canvas.dataset.testid = 'game-canvas';
    container.appendChild(app.canvas);

    this.renderer = new GameRenderer(app.renderer, this.options.textures, this.sim.world);
    app.stage.addChild(this.renderer.root);
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.watchDevicePixelRatio();

    this.input.attachKeyboard(window, () => this.pause('manual'));
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);

    this.sounds.start();
    app.ticker.add(this.tick);
    app.ticker.start();
    this.input.setEnabled(true);
    this.state.set({ phase: 'running', pauseReason: null });

    // The tab may already be hidden/unfocused when the match starts.
    if (document.visibilityState === 'hidden') this.pause('hidden');
  }

  // ------------------------------------------------------------------ loop

  private readonly tick = (ticker: Ticker): void => {
    const phase = this.phase;
    let dt = ticker.deltaMS / 1000;
    if (this.skipNextDelta) {
      this.skipNextDelta = false;
      dt = 0;
    }
    let fxDt = 0;
    if (phase === 'running' && !this.manualClock) {
      if (this.sim.advance(dt, this.input.intent()) > 0) this.input.consumeTaps();
      fxDt = dt;
    } else if (phase === 'ended') {
      // Let the final explosion/sinking animations play out.
      fxDt = dt;
    }
    this.frame(fxDt, ticker.deltaMS);
  };

  private frame(fxDt: number, frameMs: number): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const events = this.sim.drainEvents();
    renderer.render(events, this.manualClock ? 1 : this.sim.alpha, fxDt);
    this.afterEvents(events);
    if (this.phase === 'running') this.frameStats.record(frameMs, this.sim.world.ships.length + this.sim.world.projectiles.length);
  }

  private afterEvents(events: readonly GameEvent[]): void {
    this.sounds.handle(events);
    const snapshot = this.sim.hud();
    const player = this.sim.world.player;
    this.sounds.update(snapshot, player.speed / player.stats.maxSpeed);
    this.hud.set(this.hudView(snapshot));

    if (snapshot.status === 'ended' && !this.endReported) {
      this.endReported = true;
      this.input.setEnabled(false);
      this.state.set({ phase: 'ended', pauseReason: null });
      const result = this.sim.result();
      if (result) this.options.onEnded(result);
    }
  }

  private hudView(s: HudSnapshot): HudView {
    return {
      score: s.score,
      health: Math.ceil(s.health),
      maxHealth: s.maxHealth,
      secondsRemaining: Math.ceil(s.timeRemainingMs / 1000),
      enemies: s.enemies,
    };
  }

  // ----------------------------------------------------------------- pause

  pause(reason: PauseReason): void {
    if (this.phase !== 'running') return;
    this.input.setEnabled(false);
    this.state.set({ phase: 'paused', pauseReason: reason });
    this.sounds.setPaused(true);
    // Render the frozen frame once, then stop the loop entirely.
    this.frame(0, 0);
    this.app?.ticker.stop();
  }

  /** Resuming always requires an explicit player action (button / key in the dialog). */
  resume(): void {
    if (this.phase !== 'paused') return;
    // Nothing held or accumulated during the pause may leak into the match.
    this.input.reset();
    this.sim.resetAccumulator();
    this.skipNextDelta = true;
    this.state.set({ phase: 'running', pauseReason: null });
    this.input.setEnabled(true);
    this.sounds.setPaused(false);
    this.app?.ticker.start();
  }

  private readonly handleBlur = (): void => this.pause('focus-lost');

  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      this.pause('hidden');
      audio.suspend();
    } else {
      audio.resume();
    }
  };

  // ---------------------------------------------------------------- layout

  private resize(): void {
    const app = this.app;
    const container = this.container;
    if (!app || !container || !this.renderer) return;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    app.renderer.resize(width, height);
    this.renderer.resize(width, height);
    if (this.phase !== 'running') app.render();
  }

  /** Re-renders at the new density when the window moves to another screen or zoom changes. */
  private watchDevicePixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.handleDprChange);
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.handleDprChange);
  }

  private readonly handleDprChange = (): void => {
    if (!this.app) return;
    this.app.renderer.resolution = Math.min(window.devicePixelRatio || 1, MAX_RESOLUTION);
    this.resize();
    this.watchDevicePixelRatio();
  };

  // ------------------------------------------------- test instrumentation

  /** Switches between the real-time loop and a manually stepped clock. */
  setManualClock(manual: boolean): void {
    this.manualClock = manual;
    this.sim.resetAccumulator();
  }

  /**
   * Advances the simulation by `ms` of game time using the current input,
   * exactly as the real loop would (same fixed steps, same systems).
   * Ignored while paused or after the match ended.
   */
  advanceBy(ms: number): number {
    if (this.phase !== 'running') return 0;
    const stepMs = this.sim.fixedStep * 1000;
    const steps = Math.round(ms / stepMs);
    for (let i = 0; i < steps && this.sim.isRunning; i++) {
      this.sim.step(this.input.intent());
      this.input.consumeTaps();
      // Drain per step so events are processed in order, as in real time.
      this.frame(this.sim.fixedStep, stepMs);
    }
    this.app?.render();
    return steps;
  }

  /** Test setup helper: places an enemy at a given position. */
  debugSpawn(kind: EnemyKind, x: number, y: number): number {
    spawnEnemy(this.sim.world, kind, { x, y });
    const ship = this.sim.world.ships[this.sim.world.ships.length - 1];
    return ship?.id ?? -1;
  }

  renderStats(): ReturnType<GameRenderer['stats']> | null {
    return this.renderer?.stats() ?? null;
  }

  // -------------------------------------------------------------- teardown

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.setEnabled(false);
    this.input.detachKeyboard();
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.dprQuery?.removeEventListener('change', this.handleDprChange);
    this.dprQuery = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.sounds.stop();

    const app = this.app;
    this.app = null;
    if (app) {
      app.ticker.remove(this.tick);
      app.ticker.stop();
      this.renderer?.destroy();
      // Shared atlas textures stay cached in Assets for the next match.
      app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
    }
    this.renderer = null;
    this.container = null;
    this.state.set({ phase: 'destroyed', pauseReason: null });
  }
}
