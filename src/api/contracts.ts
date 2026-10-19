import { z } from 'zod';

/**
 * REST contracts for the ranking and match history APIs.
 *
 * These schemas are the single source of truth for both sides: the Axios
 * client validates every response with them and the MSW handlers validate
 * every request body with them.
 *
 *   GET /api/ranking?sessionDurationSec=&spawnIntervalSec=&page=&pageSize=
 *   GET /api/players/:playerId/matches?page=&pageSize=
 *   PUT /api/matches/:matchId                (idempotent create)
 *   GET /api/matches/:matchId
 */

export const endReasonSchema = z.enum(['time_up', 'destroyed']);
export type EndReason = z.infer<typeof endReasonSchema>;

/** Gameplay parameters a match was played with; rankings only compare equal configs. */
export const matchConfigSchema = z.object({
  sessionDurationSec: z.number().positive(),
  spawnIntervalSec: z.number().positive(),
});
export type MatchConfig = z.infer<typeof matchConfigSchema>;

export const matchRecordSchema = z.object({
  /** Client-generated UUID: the idempotency key of the record. */
  matchId: z.string().min(8).max(64),
  playerId: z.string().min(8).max(64),
  playerName: z.string().min(1).max(40),
  /** ISO-8601 timestamp of when the match ended. */
  playedAt: z.iso.datetime(),
  score: z.number().int().nonnegative(),
  /** Effective (active, unpaused) play time. */
  durationMs: z.number().int().nonnegative(),
  endReason: endReasonSchema,
  config: matchConfigSchema,
});
export type MatchRecord = z.infer<typeof matchRecordSchema>;

export const rankingEntrySchema = matchRecordSchema.extend({
  rank: z.number().int().positive(),
});
export type RankingEntry = z.infer<typeof rankingEntrySchema>;

/**
 * Paginated response. `revision` is the server's data version at the time the
 * response was produced; the client uses it to discard stale (out-of-order)
 * responses.
 */
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
  });

export const rankingPageSchema = pageSchema(rankingEntrySchema);
export type RankingPage = z.infer<typeof rankingPageSchema>;

export const historyPageSchema = pageSchema(matchRecordSchema);
export type HistoryPage = z.infer<typeof historyPageSchema>;

export const recordMatchResponseSchema = z.object({
  record: matchRecordSchema,
  /** false when the match had already been recorded (idempotent replay). */
  created: z.boolean(),
  revision: z.number().int().nonnegative(),
});
export type RecordMatchResponse = z.infer<typeof recordMatchResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const PAGE_SIZE = 5;

export interface RankingQuery {
  config: MatchConfig;
  page: number;
  pageSize?: number;
}

export interface HistoryQuery {
  playerId: string;
  page: number;
  pageSize?: number;
}

/**
 * Deterministic ranking order: score desc, then shorter effective duration
 * (same score reached faster), then earlier playedAt, then matchId.
 */
export function compareRanking(a: MatchRecord, b: MatchRecord): number {
  return (
    b.score - a.score ||
    a.durationMs - b.durationMs ||
    a.playedAt.localeCompare(b.playedAt) ||
    a.matchId.localeCompare(b.matchId)
  );
}

export const sameConfig = (a: MatchConfig, b: MatchConfig): boolean =>
  a.sessionDurationSec === b.sessionDurationSec && a.spawnIntervalSec === b.spawnIntervalSec;
