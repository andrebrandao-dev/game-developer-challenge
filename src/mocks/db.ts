import { z } from 'zod';
import { matchRecordSchema, type MatchRecord } from '@/api/contracts';
import { Rng } from '@/game/core/rng';
import { readJson, removeKey, writeJson } from '@/persistence/storage';
import { baseFixtures } from './fixtures';
import { DEFAULT_SCENARIO_ID, findScenario, type ScenarioDef } from './scenarios';

/**
 * In-browser "server" state for the mocked APIs, persisted in localStorage so
 * confirmed records survive refreshes. Fixtures are static and not stored;
 * only records created through the API are.
 */

const DB_KEY = 'pirate-battle:mock-db:v1';
const SCENARIO_KEY = 'pirate-battle:mock-scenario:v1';
const LATENCY_SEED = 0xc0ffee;

const dbSchema = z.object({
  revision: z.number().int().nonnegative(),
  records: z.array(matchRecordSchema),
  /** Match ids whose first (committed) attempt was deliberately left unanswered. */
  hungOnce: z.array(z.string()),
});

type DbState = z.infer<typeof dbSchema>;

const emptyDb = (): DbState => ({ revision: 1, records: [], hungOnce: [] });

let state: DbState = readJson(DB_KEY, dbSchema, emptyDb());
let scenario: ScenarioDef = findScenario(readJson(SCENARIO_KEY, z.string(), DEFAULT_SCENARIO_ID));
let latencyRng = new Rng(LATENCY_SEED);
let requestCount = 0;
const fixtures = baseFixtures();

const persist = () => writeJson(DB_KEY, state);

export const mockDb = {
  get revision(): number {
    return state.revision;
  },

  /** Fixtures plus every confirmed record. */
  allRecords(): MatchRecord[] {
    return [...fixtures, ...state.records];
  },

  find(matchId: string): MatchRecord | undefined {
    return state.records.find((r) => r.matchId === matchId) ?? fixtures.find((r) => r.matchId === matchId);
  },

  insert(record: MatchRecord): void {
    state = { ...state, revision: state.revision + 1, records: [...state.records, record] };
    persist();
  },

  hasHung(matchId: string): boolean {
    return state.hungOnce.includes(matchId);
  },

  markHung(matchId: string): void {
    state = { ...state, hungOnce: [...state.hungOnce, matchId] };
    persist();
  },

  /** Restores the initial server state (fixtures only) and the latency sequence. */
  reset(): void {
    state = emptyDb();
    removeKey(DB_KEY);
    latencyRng = new Rng(LATENCY_SEED);
    requestCount = 0;
  },
};

export const mockScenario = {
  get current(): ScenarioDef {
    return scenario;
  },

  select(id: string): ScenarioDef {
    scenario = findScenario(id);
    writeJson(SCENARIO_KEY, scenario.id);
    latencyRng = new Rng(LATENCY_SEED);
    requestCount = 0;
    return scenario;
  },

  /** Next response delay according to the active scenario (seeded). */
  nextLatency(): number {
    const latency = scenario.latency;
    requestCount++;
    switch (latency.kind) {
      case 'fixed':
        return latency.ms;
      case 'random':
        return Math.round(latencyRng.range(latency.minMs, latency.maxMs));
      case 'alternating':
        return requestCount % 2 === 1 ? latency.slowMs : latency.fastMs;
    }
  },
};
