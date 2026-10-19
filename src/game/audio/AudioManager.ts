import { readJson, writeJson } from '@/persistence/storage';
import { z } from 'zod';

export const SOUND_IDS = [
  'cannon_broadside',
  'cannon_fire_1',
  'cannon_fire_2',
  'cannon_fire_3',
  'cannonball_water_hit_1',
  'cannonball_water_hit_2',
  'game_complete',
  'game_over',
  'game_pause',
  'game_resume',
  'game_start',
  'health_low',
  'ocean_ambience_loop',
  'score_point',
  'ship_collision',
  'ship_explosion_1',
  'ship_explosion_2',
  'ship_sailing_loop',
  'ship_sinking',
  'ship_wood_hit_1',
  'ship_wood_hit_2',
  'time_warning',
  'ui_back',
  'ui_click',
  'ui_close',
  'ui_hover',
  'ui_open',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

const BASE = `${import.meta.env.BASE_URL}game/sounds/`;
const MUTE_KEY = 'pirate-battle:audio-muted:v1';
/** Same sound is not restarted more often than this (avoids phasing/clipping). */
const MIN_REPLAY_GAP_MS = 45;

export interface LoopHandle {
  setVolume(volume: number): void;
  stop(): void;
}

const NOOP_LOOP: LoopHandle = { setVolume: () => undefined, stop: () => undefined };

/**
 * Small Web Audio wrapper. Audio is strictly best-effort: decoding failures,
 * blocked autoplay or missing support never affect gameplay.
 */
class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<SoundId, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private readonly lastPlayed = new Map<SoundId, number>();
  private mutedValue = readJson(MUTE_KEY, z.boolean(), false);
  private readonly listeners = new Set<() => void>();

  get muted(): boolean {
    return this.mutedValue;
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    writeJson(MUTE_KEY, muted);
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.mutedValue ? 0 : 1;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    void this.preload();
  }

  /** Fetches and decodes every sound in the background. Never rejects. */
  preload(): Promise<void> {
    if (this.loading) return this.loading;
    const ctx = this.context();
    if (!ctx) return Promise.resolve();
    this.loading = Promise.all(
      SOUND_IDS.map(async (id) => {
        try {
          const response = await fetch(`${BASE}${id}.wav`);
          if (!response.ok) return;
          const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(id, buffer);
        } catch {
          // Best effort: a missing sound simply stays silent.
        }
      }),
    ).then(() => undefined);
    return this.loading;
  }

  play(id: SoundId, volume = 1, playbackRate = 1): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(id);
    if (!ctx || !this.master || !buffer || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (this.lastPlayed.get(id) ?? -Infinity) < MIN_REPLAY_GAP_MS) return;
    this.lastPlayed.set(id, now);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  playRandom(ids: readonly SoundId[], volume = 1): void {
    const id = ids[Math.floor(Math.random() * ids.length)];
    if (id) this.play(id, volume, 0.94 + Math.random() * 0.12);
  }

  /** Starts a looping sound; volume can be changed smoothly afterwards. */
  loop(id: SoundId, volume: number): LoopHandle {
    const ctx = this.ctx;
    const buffer = this.buffers.get(id);
    if (!ctx || !this.master || !buffer) return NOOP_LOOP;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.master);
    source.start();
    let stopped = false;
    return {
      setVolume: (v) => {
        if (!stopped) gain.gain.setTargetAtTime(v, ctx.currentTime, 0.15);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
        source.disconnect();
        gain.disconnect();
      },
    };
  }

  /** Suspends output (pause/hidden tab) without losing loaded buffers. */
  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }
}

export const audio = new AudioManager();
