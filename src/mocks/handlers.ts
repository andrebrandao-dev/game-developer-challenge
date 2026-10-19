import { delay, http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@/api/client';
import {
  compareRanking,
  matchRecordSchema,
  sameConfig,
  type ApiErrorBody,
  type HistoryPage,
  type MatchRecord,
  type RankingPage,
  type RecordMatchResponse,
} from '@/api/contracts';
import { mockDb, mockScenario } from './db';
import { largeFixtures, largeHistory } from './fixtures';
import type { Outcome } from './scenarios';

const MAX_PAGE_SIZE = 50;

const errorBody = (code: string, message: string): ApiErrorBody => ({ error: { code, message } });

const badRequest = (message: string) => HttpResponse.json(errorBody('bad_request', message), { status: 400 });

/**
 * Applies the scenario's latency and failure mode. Returns a response to
 * short-circuit the handler, or null to continue with the normal behaviour.
 */
async function applyScenario(outcome: Outcome): Promise<Response | null> {
  await delay(mockScenario.nextLatency());
  switch (outcome.kind) {
    case 'hang':
      await delay('infinite');
      return null;
    case 'network-error':
      return HttpResponse.error();
    case 'status':
      return HttpResponse.json(errorBody(outcome.code, outcome.message), { status: outcome.status });
    case 'ok':
    case 'empty':
      return null;
  }
}

function parsePaging(url: URL): { page: number; pageSize: number } | string {
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '5');
  if (!Number.isInteger(page) || page < 1) return 'page must be a positive integer';
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) return `pageSize must be 1-${MAX_PAGE_SIZE}`;
  return { page, pageSize };
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalItems = items.length;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
    revision: mockDb.revision,
  };
}

const url = (path: string) => `${API_BASE_URL}${path}`;

export const handlers = [
  http.get(url('/ranking'), async ({ request }) => {
    const scenario = mockScenario.current;
    const short = await applyScenario(scenario.ranking);
    if (short) return short;

    const params = new URL(request.url).searchParams;
    const config = {
      sessionDurationSec: Number(params.get('sessionDurationSec')),
      spawnIntervalSec: Number(params.get('spawnIntervalSec')),
    };
    if (!(config.sessionDurationSec > 0) || !(config.spawnIntervalSec > 0)) {
      return badRequest('sessionDurationSec and spawnIntervalSec are required');
    }
    const paging = parsePaging(new URL(request.url));
    if (typeof paging === 'string') return badRequest(paging);

    let records: MatchRecord[] = [];
    if (scenario.ranking.kind !== 'empty') {
      records = mockDb.allRecords().filter((r) => sameConfig(r.config, config));
      if (scenario.largeDataset) records = [...records, ...largeFixtures(config)];
    }
    const ranked = records.sort(compareRanking).map((r, i) => ({ ...r, rank: i + 1 }));
    const body: RankingPage = paginate(ranked, paging.page, paging.pageSize);
    return HttpResponse.json(body);
  }),

  http.get(url('/players/:playerId/matches'), async ({ request, params }) => {
    const scenario = mockScenario.current;
    const short = await applyScenario(scenario.history);
    if (short) return short;

    const playerId = String(params.playerId);
    const paging = parsePaging(new URL(request.url));
    if (typeof paging === 'string') return badRequest(paging);

    let records: MatchRecord[] = [];
    if (scenario.history.kind !== 'empty') {
      records = mockDb.allRecords().filter((r) => r.playerId === playerId);
      if (scenario.largeDataset) {
        const name = records[0]?.playerName ?? 'Captain';
        records = [...records, ...largeHistory(playerId, name)];
      }
    }
    // Most recent first, matchId as a deterministic tie-breaker.
    records.sort((a, b) => b.playedAt.localeCompare(a.playedAt) || a.matchId.localeCompare(b.matchId));
    const body: HistoryPage = paginate(records, paging.page, paging.pageSize);
    return HttpResponse.json(body);
  }),

  http.get(url('/matches/:matchId'), async ({ params }) => {
    await delay(mockScenario.nextLatency());
    const record = mockDb.find(String(params.matchId));
    if (!record) return HttpResponse.json(errorBody('not_found', 'Match not found'), { status: 404 });
    return HttpResponse.json(record);
  }),

  /**
   * Idempotent create keyed by the client-generated match id:
   * 201 when created, 200 with the stored record when it already exists,
   * 409 when the id exists with a different payload.
   */
  http.put(url('/matches/:matchId'), async ({ request, params }) => {
    const scenario = mockScenario.current;
    const outcome = scenario.record;
    const short = outcome.kind === 'commit-then-hang' ? (await delay(mockScenario.nextLatency()), null) : await applyScenario(outcome);
    if (short) return short;

    const matchId = String(params.matchId);
    const parsed = matchRecordSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest('Invalid match record');
    const record = parsed.data;
    if (record.matchId !== matchId) return badRequest('matchId in the URL and body differ');

    const existing = mockDb.find(matchId);
    if (existing) {
      if (existing.playerId !== record.playerId || existing.score !== record.score) {
        return HttpResponse.json(errorBody('conflict', 'A different match with this id already exists'), { status: 409 });
      }
      const body: RecordMatchResponse = { record: existing, created: false, revision: mockDb.revision };
      return HttpResponse.json(body, { status: 200 });
    }

    mockDb.insert(record);
    if (outcome.kind === 'commit-then-hang' && !mockDb.hasHung(matchId)) {
      // Stored, but the client never hears back: it must retry without creating a duplicate.
      mockDb.markHung(matchId);
      await delay('infinite');
    }
    const body: RecordMatchResponse = { record, created: true, revision: mockDb.revision };
    return HttpResponse.json(body, { status: 201 });
  }),
];
