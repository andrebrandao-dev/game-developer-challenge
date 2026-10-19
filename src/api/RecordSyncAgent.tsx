import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toApiError } from './client';
import type { MatchRecord, RecordMatchResponse } from './contracts';
import { putMatchRecord } from './endpoints';
import { markConfirmed, markFailed, markSyncing, outboxStore, requeue } from './pendingRecords';
import { noteRevision, queryKeys, retryDelay } from './queries';

const MAX_RECORD_RETRIES = 2;
export const NETWORK_CHANGED_EVENT = 'pirate-battle:network-changed';

/**
 * Invisible component (mounted once at the app root) that drains the outbox
 * through a TanStack Query mutation:
 *
 * - every pending record is sent with an idempotent PUT;
 * - mutations share one scope, so they run serially (never two PUTs racing);
 * - an in-flight set prevents the same record from being sent twice at once;
 * - transient failures are retried with backoff, then the record is marked
 *   failed and kept for a manual or automatic retry (boot, back online,
 *   network scenario change);
 * - on success both ranking and history are invalidated.
 */
export function RecordSyncAgent() {
  const queryClient = useQueryClient();
  const inFlight = useRef(new Set<string>());

  const { mutate } = useMutation<RecordMatchResponse, unknown, MatchRecord>({
    mutationKey: ['recordMatch'],
    scope: { id: 'record-match' },
    mutationFn: putMatchRecord,
    retry: (failureCount, error) => toApiError(error).retryable && failureCount < MAX_RECORD_RETRIES,
    retryDelay,
    onSuccess: async (response) => {
      noteRevision(response.revision);
      markConfirmed(response.record.matchId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.rankingAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.historyAll }),
      ]);
    },
    onError: (error, record) => {
      markFailed(record.matchId, toApiError(error).userMessage);
    },
    onSettled: (_data, _error, record) => {
      inFlight.current.delete(record.matchId);
    },
  });

  useEffect(() => {
    const flush = () => {
      for (const item of outboxStore.get().pending) {
        const id = item.record.matchId;
        if (item.status !== 'pending' || inFlight.current.has(id)) continue;
        inFlight.current.add(id);
        markSyncing(id);
        mutate(item.record);
      }
    };
    const retryFailed = () => {
      // Back online / network changed: give failed records another chance.
      requeue();
      flush();
    };

    flush();
    const unsubscribe = outboxStore.subscribe(flush);
    window.addEventListener('online', retryFailed);
    window.addEventListener(NETWORK_CHANGED_EVENT, retryFailed);
    return () => {
      unsubscribe();
      window.removeEventListener('online', retryFailed);
      window.removeEventListener(NETWORK_CHANGED_EVENT, retryFailed);
    };
  }, [mutate]);

  return null;
}
