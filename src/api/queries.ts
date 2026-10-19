import { keepPreviousData, QueryClient, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError, toApiError } from './client';
import type { HistoryPage, MatchConfig, RankingPage } from './contracts';
import { fetchHistory, fetchRanking } from './endpoints';

const MAX_QUERY_RETRIES = 2;

export const queryKeys = {
  rankingAll: ['ranking'] as const,
  ranking: (config: MatchConfig, page: number) =>
    ['ranking', config.sessionDurationSec, config.spawnIntervalSec, page] as const,
  historyAll: ['history'] as const,
  history: (playerId: string, page: number) => ['history', playerId, page] as const,
};

/** Deterministic exponential backoff (no jitter, so tests are reproducible). */
export const retryDelay = (attempt: number): number => Math.min(4000, 500 * 2 ** attempt);

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        // Tabs refresh every time they are shown again (cached data stays visible meanwhile).
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => toApiError(error).retryable && failureCount < MAX_QUERY_RETRIES,
        retryDelay,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Highest data revision the client has observed (from list responses and
 * confirmed writes). A list response carrying an older revision was produced
 * before data we already know about, so it must not replace newer data.
 */
let latestKnownRevision = 0;

export function noteRevision(revision: number): void {
  if (revision > latestKnownRevision) latestKnownRevision = revision;
}

export function resetKnownRevision(): void {
  latestKnownRevision = 0;
}

interface Revisioned {
  revision: number;
}

/**
 * Guards a query result against out-of-order responses: if the server answer
 * is older than what is cached (or older than a write we already confirmed),
 * keep the newer cached data / refetch once instead of going back in time.
 */
async function freshest<T extends Revisioned>(
  client: QueryClient,
  key: QueryKey,
  load: () => Promise<T>,
): Promise<T> {
  let result = await load();
  if (result.revision < latestKnownRevision) {
    // Produced before a write we already saw: ask again once.
    result = await load();
  }
  const cached = client.getQueryData<T>(key);
  if (cached && cached.revision > result.revision) return cached;
  noteRevision(result.revision);
  return result;
}

export function useRankingQuery(config: MatchConfig, page: number) {
  const client = useQueryClient();
  const key = queryKeys.ranking(config, page);
  return useQuery<RankingPage, ApiError>({
    queryKey: key,
    queryFn: ({ signal }) => freshest(client, key, () => fetchRanking({ config, page }, signal)),
    placeholderData: keepPreviousData,
  });
}

export function useHistoryQuery(playerId: string, page: number) {
  const client = useQueryClient();
  const key = queryKeys.history(playerId, page);
  return useQuery<HistoryPage, ApiError>({
    queryKey: key,
    queryFn: ({ signal }) => freshest(client, key, () => fetchHistory({ playerId, page }, signal)),
    placeholderData: keepPreviousData,
  });
}
