import type { GameEvent } from '../core/types';
import type { HudSnapshot } from '../core/simulation';
import { audio, type LoopHandle } from './AudioManager';

const LOW_HEALTH_RATIO = 0.3;
const TIME_WARNING_SEC = 10;

/** Translates simulation events and HUD changes into sound effects. */
export class SoundDirector {
  private ambience: LoopHandle | null = null;
  private sailing: LoopHandle | null = null;
  private lowHealthPlayed = false;
  private lastWarningSecond = Number.POSITIVE_INFINITY;

  constructor(private readonly playerId: number) {}

  start(): void {
    this.ambience = audio.loop('ocean_ambience_loop', 0.35);
    this.sailing = audio.loop('ship_sailing_loop', 0);
  }

  handle(events: readonly GameEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'matchStarted':
          audio.play('game_start', 0.7);
          break;
        case 'shotFired':
          if (e.shipId !== this.playerId) audio.playRandom(['cannon_fire_1', 'cannon_fire_2', 'cannon_fire_3'], 0.35);
          else if (e.slot === 'front') audio.playRandom(['cannon_fire_1', 'cannon_fire_2', 'cannon_fire_3'], 0.75);
          else audio.play('cannon_broadside', 0.85);
          break;
        case 'projectileExpired':
          if (e.on === 'water') audio.playRandom(['cannonball_water_hit_1', 'cannonball_water_hit_2'], 0.3);
          break;
        case 'shipHit':
          audio.playRandom(['ship_wood_hit_1', 'ship_wood_hit_2'], e.kind === 'player' ? 0.9 : 0.6);
          break;
        case 'shipDestroyed':
          audio.playRandom(['ship_explosion_1', 'ship_explosion_2'], 0.8);
          if (e.kind === 'player') audio.play('ship_sinking', 0.8);
          break;
        case 'shipRammed':
          audio.play('ship_collision', 0.9);
          break;
        case 'collision':
          if (e.shipId === this.playerId) audio.play('ship_collision', 0.35);
          break;
        case 'scoreChanged':
          audio.play('score_point', 0.6);
          break;
        case 'matchEnded':
          audio.play(e.reason === 'time_up' ? 'game_complete' : 'game_over', 0.85);
          this.sailing?.setVolume(0);
          break;
        case 'shipSpawned':
          break;
      }
    }
  }

  update(hud: HudSnapshot, playerSpeedRatio: number): void {
    this.sailing?.setVolume(hud.status === 'running' ? playerSpeedRatio * 0.45 : 0);

    const lowHealth = hud.health > 0 && hud.health / hud.maxHealth <= LOW_HEALTH_RATIO;
    if (lowHealth && !this.lowHealthPlayed) audio.play('health_low', 0.8);
    this.lowHealthPlayed = lowHealth;

    const second = Math.ceil(hud.timeRemainingMs / 1000);
    if (hud.status === 'running' && second <= TIME_WARNING_SEC && second > 0 && second < this.lastWarningSecond) {
      audio.play('time_warning', 0.6);
    }
    this.lastWarningSecond = second;
  }

  setPaused(paused: boolean): void {
    audio.play(paused ? 'game_pause' : 'game_resume', 0.6);
    this.ambience?.setVolume(paused ? 0.12 : 0.35);
    if (paused) this.sailing?.setVolume(0);
  }

  stop(): void {
    this.ambience?.stop();
    this.sailing?.stop();
    this.ambience = null;
    this.sailing = null;
  }
}
