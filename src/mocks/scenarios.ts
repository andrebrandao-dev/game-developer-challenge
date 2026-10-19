/**
 * Configurable, reproducible network scenarios for the mocked APIs.
 * Latency randomness comes from a seeded PRNG that is reset whenever the
 * scenario changes or the mock state is reset, so runs are repeatable.
 */

export type Latency =
  | { kind: 'fixed'; ms: number }
  | { kind: 'random'; minMs: number; maxMs: number }
  /** Odd requests are slow, even requests fast: responses come back out of order. */
  | { kind: 'alternating'; slowMs: number; fastMs: number };

export type Outcome =
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'hang' }
  | { kind: 'network-error' }
  | { kind: 'status'; status: number; code: string; message: string };

export type RecordOutcome =
  | Outcome
  /** Stores the record, then never answers the first attempt (client times out). */
  | { kind: 'commit-then-hang' };

export interface ScenarioDef {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly latency: Latency;
  readonly ranking: Outcome;
  readonly history: Outcome;
  readonly record: RecordOutcome;
  /** Adds many generated rivals so lists span several pages. */
  readonly largeDataset?: boolean;
}

const OK: Outcome = { kind: 'ok' };
const fast: Latency = { kind: 'random', minMs: 120, maxMs: 380 };
const serverError: Outcome = { kind: 'status', status: 500, code: 'internal_error', message: 'Internal server error' };
const unavailable: Outcome = { kind: 'status', status: 503, code: 'unavailable', message: 'Service temporarily unavailable' };

export const SCENARIOS: readonly ScenarioDef[] = [
  { id: 'normal', label: 'Normal', description: 'Everything works with small, realistic latency.', latency: fast, ranking: OK, history: OK, record: OK },
  { id: 'empty', label: 'Empty lists', description: 'Ranking and history return no entries.', latency: fast, ranking: { kind: 'empty' }, history: { kind: 'empty' }, record: OK },
  { id: 'many-pages', label: 'Many pages', description: 'Large dataset spanning many pages.', latency: fast, ranking: OK, history: OK, record: OK, largeDataset: true },
  { id: 'slow', label: 'Slow network', description: 'Every response takes 2.5 s.', latency: { kind: 'fixed', ms: 2500 }, ranking: OK, history: OK, record: OK },
  { id: 'variable-latency', label: 'Variable latency', description: 'Latency varies between 50 ms and 3 s.', latency: { kind: 'random', minMs: 50, maxMs: 3000 }, ranking: OK, history: OK, record: OK },
  { id: 'out-of-order', label: 'Out-of-order responses', description: 'Alternating slow (2.5 s) and fast (100 ms) responses.', latency: { kind: 'alternating', slowMs: 2500, fastMs: 100 }, ranking: OK, history: OK, record: OK },
  { id: 'timeout', label: 'Timeouts', description: 'No request ever gets an answer.', latency: fast, ranking: { kind: 'hang' }, history: { kind: 'hang' }, record: { kind: 'hang' } },
  { id: 'offline', label: 'Connection failure', description: 'Requests fail at the network level.', latency: fast, ranking: { kind: 'network-error' }, history: { kind: 'network-error' }, record: { kind: 'network-error' } },
  { id: 'http-400', label: 'HTTP 400', description: 'Every request is rejected as invalid.', latency: fast, ranking: { kind: 'status', status: 400, code: 'bad_request', message: 'The request was rejected as invalid.' }, history: { kind: 'status', status: 400, code: 'bad_request', message: 'The request was rejected as invalid.' }, record: { kind: 'status', status: 400, code: 'bad_request', message: 'The request was rejected as invalid.' } },
  { id: 'http-500', label: 'HTTP 500', description: 'Every request fails with a server error.', latency: fast, ranking: serverError, history: serverError, record: serverError },
  { id: 'ranking-fails', label: 'Ranking fails', description: 'Only the ranking endpoint fails (500).', latency: fast, ranking: serverError, history: OK, record: OK },
  { id: 'history-fails', label: 'History fails', description: 'Only the history endpoint fails (500).', latency: fast, ranking: OK, history: serverError, record: OK },
  { id: 'record-timeout', label: 'Timeout after saving', description: 'The first save is stored but never answered; the retry must not duplicate it.', latency: fast, ranking: OK, history: OK, record: { kind: 'commit-then-hang' } },
  { id: 'record-unavailable', label: 'Saving unavailable', description: 'Saving fails with 503 until another scenario is selected.', latency: fast, ranking: OK, history: OK, record: unavailable },
];

export const DEFAULT_SCENARIO_ID = 'normal';

export function findScenario(id: string | null | undefined): ScenarioDef {
  return SCENARIOS.find((s) => s.id === id) ?? (SCENARIOS[0] as ScenarioDef);
}
