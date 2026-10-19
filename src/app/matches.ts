import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { matchRecordSchema, type MatchRecord } from '@/api/contracts';
import { enqueueRecord } from '@/api/pendingRecords';
import { createMatchConfig, type GameConfig, type PlayerOptions } from '@/config/gameConfig';
import { randomSeed } from '@/game/core/rng';
import type { MatchResult } from '@/game/core/types';
import { ValueStore } from '@/lib/store';
import { readJson, writeJson } from '@/persistence/storage';
import { optionsStore, profileStore, STORAGE_KEYS } from './preferences';
import { runtimeFlags } from './runtimeFlags';

/** A match being played. Lives in memory only: a refresh abandons it. */
export interface ActiveMatch {
  readonly matchId: string;
  readonly options: PlayerOptions;
  /** Immutable snapshot taken at start; later option changes do not affect it. */
  readonly config: GameConfig;
  readonly seed: number;
}

export interface StoredResult {
  readonly record: MatchRecord;
  readonly kills: { chaser: number; shooter: number };
}

const storedResultSchema = z.object({
  record: matchRecordSchema,
  kills: z.object({ chaser: z.number().int().nonnegative(), shooter: z.number().int().nonnegative() }),
});

export const activeMatchStore = new ValueStore<{ match: ActiveMatch | null }>({ match: null });
export const lastResultStore = new ValueStore<{ result: StoredResult | null }>({
  result: readJson<StoredResult | null>(STORAGE_KEYS.lastResult, storedResultSchema, null),
});

export function startMatch(): ActiveMatch {
  const options = { ...optionsStore.get() };
  const match: ActiveMatch = {
    matchId: crypto.randomUUID(),
    options,
    config: createMatchConfig(options),
    seed: runtimeFlags.seed ?? randomSeed(),
  };
  activeMatchStore.set({ match });
  return match;
}

/**
 * Called once when a match ends (time up or destroyed). The result is
 * persisted and queued for the API *before* any network call, so neither a
 * failure nor a refresh can lose or duplicate it.
 */
export function completeMatch(match: ActiveMatch, result: MatchResult): StoredResult {
  const profile = profileStore.get();
  const record: MatchRecord = {
    matchId: match.matchId,
    playerId: profile.playerId,
    playerName: profile.name,
    playedAt: new Date().toISOString(),
    score: result.score,
    durationMs: result.durationMs,
    endReason: result.reason,
    config: { ...match.options },
  };
  const stored: StoredResult = { record, kills: { ...result.kills } };
  writeJson(STORAGE_KEYS.lastResult, stored);
  lastResultStore.set({ result: stored });
  enqueueRecord(record);
  return stored;
}

/** Leaving the battle early: nothing is recorded. */
export function abandonMatch(): void {
  activeMatchStore.set({ match: null });
}

export const useActiveMatch = () => useSyncExternalStore(activeMatchStore.subscribe, activeMatchStore.get).match;
export const useLastResult = () => useSyncExternalStore(lastResultStore.subscribe, lastResultStore.get).result;
