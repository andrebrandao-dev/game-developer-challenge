import { request } from './client';
import {
  historyPageSchema,
  PAGE_SIZE,
  rankingPageSchema,
  recordMatchResponseSchema,
  type HistoryPage,
  type HistoryQuery,
  type MatchRecord,
  type RankingPage,
  type RankingQuery,
  type RecordMatchResponse,
} from './contracts';

export async function fetchRanking(query: RankingQuery, signal?: AbortSignal): Promise<RankingPage> {
  const { data } = await request(rankingPageSchema, {
    method: 'GET',
    url: '/ranking',
    params: {
      sessionDurationSec: query.config.sessionDurationSec,
      spawnIntervalSec: query.config.spawnIntervalSec,
      page: query.page,
      pageSize: query.pageSize ?? PAGE_SIZE,
    },
    ...(signal ? { signal } : {}),
  });
  return data;
}

export async function fetchHistory(query: HistoryQuery, signal?: AbortSignal): Promise<HistoryPage> {
  const { data } = await request(historyPageSchema, {
    method: 'GET',
    url: `/players/${encodeURIComponent(query.playerId)}/matches`,
    params: { page: query.page, pageSize: query.pageSize ?? PAGE_SIZE },
    ...(signal ? { signal } : {}),
  });
  return data;
}

/**
 * Idempotent create: the client-generated matchId is part of the URL, so
 * re-sending the same record (after a timeout, a double click or a refresh)
 * returns the existing record instead of creating a duplicate.
 */
export async function putMatchRecord(record: MatchRecord): Promise<RecordMatchResponse> {
  const { data } = await request(recordMatchResponseSchema, {
    method: 'PUT',
    url: `/matches/${encodeURIComponent(record.matchId)}`,
    data: record,
  });
  return data;
}
