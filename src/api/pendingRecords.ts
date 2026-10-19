import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { ValueStore } from '@/lib/store';
import { readJson, removeKey, writeJson } from '@/persistence/storage';
import { matchRecordSchema, type MatchRecord } from './contracts';

/**
 * Outbox for match records. A finished match is written here *before* the
 * first network attempt, so it survives failures, timeouts and refreshes.
 * Records leave the outbox only once the server confirmed them.
 */

export type PendingStatus = 'pending' | 'syncing' | 'failed';

export interface PendingRecord {
  record: MatchRecord;
  status: PendingStatus;
  attempts: number;
  lastError: string | null;
}

export interface OutboxState {
  pending: PendingRecord[];
  /** Recently confirmed match ids (bounded), for status display. */
  confirmed: string[];
}

const KEY = 'pirate-battle:outbox:v1';
const MAX_CONFIRMED = 50;

const pendingSchema = z.object({
  record: matchRecordSchema,
  status: z.enum(['pending', 'syncing', 'failed']),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});

const outboxSchema = z.object({
  pending: z.array(pendingSchema),
  confirmed: z.array(z.string()),
});

function load(): OutboxState {
  const state = readJson<OutboxState>(KEY, outboxSchema, { pending: [], confirmed: [] });
  // A request interrupted by a refresh is unknown, not lost: resend it (the server is idempotent).
  return {
    ...state,
    pending: state.pending.map((p) => (p.status === 'syncing' ? { ...p, status: 'pending' } : p)),
  };
}

export const outboxStore = new ValueStore<OutboxState>(load());

function commit(next: OutboxState): void {
  outboxStore.set(next);
  writeJson(KEY, next);
}

function updatePending(matchId: string, change: (p: PendingRecord) => PendingRecord): void {
  const state = outboxStore.get();
  commit({ ...state, pending: state.pending.map((p) => (p.record.matchId === matchId ? change(p) : p)) });
}

/** Adds a finished match to the outbox. No-op if it is already queued or confirmed. */
export function enqueueRecord(record: MatchRecord): void {
  const state = outboxStore.get();
  if (state.confirmed.includes(record.matchId) || state.pending.some((p) => p.record.matchId === record.matchId)) return;
  commit({ ...state, pending: [...state.pending, { record, status: 'pending', attempts: 0, lastError: null }] });
}

export function markSyncing(matchId: string): void {
  updatePending(matchId, (p) => ({ ...p, status: 'syncing', attempts: p.attempts + 1 }));
}

export function markFailed(matchId: string, error: string): void {
  updatePending(matchId, (p) => ({ ...p, status: 'failed', lastError: error }));
}

/** Puts failed records back in the queue (manual "Try again"). */
export function requeue(matchId?: string): void {
  const state = outboxStore.get();
  commit({
    ...state,
    pending: state.pending.map((p) =>
      p.status === 'failed' && (matchId === undefined || p.record.matchId === matchId) ? { ...p, status: 'pending' } : p,
    ),
  });
}

export function markConfirmed(matchId: string): void {
  const state = outboxStore.get();
  const confirmed = [matchId, ...state.confirmed.filter((id) => id !== matchId)].slice(0, MAX_CONFIRMED);
  commit({ pending: state.pending.filter((p) => p.record.matchId !== matchId), confirmed });
}

export function clearOutbox(): void {
  removeKey(KEY);
  outboxStore.set({ pending: [], confirmed: [] });
}

export type RecordState = { state: 'saved' } | { state: 'unknown' } | ({ state: PendingStatus } & Pick<PendingRecord, 'attempts' | 'lastError'>);

export function recordStateOf(outbox: OutboxState, matchId: string): RecordState {
  if (outbox.confirmed.includes(matchId)) return { state: 'saved' };
  const pending = outbox.pending.find((p) => p.record.matchId === matchId);
  if (!pending) return { state: 'unknown' };
  return { state: pending.status, attempts: pending.attempts, lastError: pending.lastError };
}

export const useOutbox = (): OutboxState => useSyncExternalStore(outboxStore.subscribe, outboxStore.get);
