import type { MatchConfig, MatchRecord } from '@/api/contracts';
import { Rng } from '@/game/core/rng';

/**
 * Deterministic fixtures for rival captains. Dates are fixed (not relative to
 * "now") so screenshots and tests are stable.
 */
export const RIVAL_NAMES = [
  'Captain Flint',
  'Red Sparrow',
  'Storm Rider',
  'Sea Wolf',
  'Black Annie',
  'Iron Hook',
  'Salty Pete',
  'Mad Morgan',
  'Silver Gull',
  'One-Eyed Nell',
  'Barnacle Bill',
  'Tide Hunter',
] as const;

const BASE_TIME = Date.UTC(2026, 8, 8, 21, 42);

const FIXTURE_CONFIGS: readonly { config: MatchConfig; count: number }[] = [
  { config: { sessionDurationSec: 120, spawnIntervalSec: 3 }, count: 12 },
  { config: { sessionDurationSec: 60, spawnIntervalSec: 3 }, count: 6 },
  { config: { sessionDurationSec: 180, spawnIntervalSec: 3 }, count: 7 },
  { config: { sessionDurationSec: 120, spawnIntervalSec: 2 }, count: 4 },
];

const rivalId = (index: number) => `rival-${String(index + 1).padStart(4, '0')}-0000-4000-8000-000000000000`;

function makeRecords(config: MatchConfig, count: number, seed: number, idPrefix: string): MatchRecord[] {
  const rng = new Rng(seed);
  const records: MatchRecord[] = [];
  for (let i = 0; i < count; i++) {
    const nameIndex = i % RIVAL_NAMES.length;
    const destroyed = rng.next() < 0.3;
    const durationMs = destroyed
      ? Math.round(rng.range(0.35, 0.95) * config.sessionDurationSec) * 1000
      : config.sessionDurationSec * 1000;
    const perMinute = rng.range(4, 16) / config.spawnIntervalSec;
    records.push({
      matchId: `${idPrefix}-${String(i + 1).padStart(4, '0')}`,
      playerId: rivalId(nameIndex),
      playerName: RIVAL_NAMES[nameIndex] ?? 'Rival',
      playedAt: new Date(BASE_TIME - i * 26 * 60_000 - rng.int(0, 20) * 60_000).toISOString(),
      score: Math.max(0, Math.round((durationMs / 60_000) * perMinute * 3)),
      durationMs,
      endReason: destroyed ? 'destroyed' : 'time_up',
      config,
    });
  }
  return records;
}

/** Base rival records, present in every fresh mock database. */
export function baseFixtures(): MatchRecord[] {
  return FIXTURE_CONFIGS.flatMap(({ config, count }, i) =>
    makeRecords(config, count, 1000 + i, `fixture-${config.sessionDurationSec}-${config.spawnIntervalSec}`),
  );
}

/** Extra rival records for the "many pages" scenario, generated for any config. */
export function largeFixtures(config: MatchConfig): MatchRecord[] {
  return makeRecords(config, 60, 7000 + config.sessionDurationSec + config.spawnIntervalSec * 10, `bulk-${config.sessionDurationSec}-${config.spawnIntervalSec}`);
}

/** Extra history entries for the current player in the "many pages" scenario. */
export function largeHistory(playerId: string, playerName: string): MatchRecord[] {
  return makeRecords({ sessionDurationSec: 120, spawnIntervalSec: 3 }, 23, 9100, `bulk-history`).map((r) => ({
    ...r,
    playerId,
    playerName,
  }));
}
