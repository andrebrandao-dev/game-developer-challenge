/**
 * URL flags read once at boot. They exist for reproducible testing and
 * profiling, and work in the published build as well:
 *
 *   ?testHooks=1      expose window.__pirateBattle (state inspection + clock control)
 *   ?clock=manual     the simulation only advances through the test hooks
 *   ?seed=1234        fixed gameplay seed (spawn points, enemy mix)
 *   ?perf=1           show the frame-time overlay
 *   ?scenario=slow    select a mock network scenario at boot (see src/mocks/scenarios.ts)
 *   ?apiTimeout=1500  override the HTTP client timeout in milliseconds
 */
const params = new URLSearchParams(window.location.search);

const parsePositiveInt = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const parseSeed = (value: string | null): number | null => {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n >>> 0 : null;
};

export const runtimeFlags = {
  testHooks: params.get('testHooks') === '1',
  manualClock: params.get('clock') === 'manual',
  seed: parseSeed(params.get('seed')),
  perfOverlay: params.get('perf') === '1',
  scenario: params.get('scenario'),
  apiTimeoutMs: parsePositiveInt(params.get('apiTimeout')),
} as const;
