import { DEFAULT_GAME_CONFIG, type GameConfig } from '@/config/gameConfig';

/**
 * Test-only balancing overrides (e.g. a sturdier player so a match can reach
 * its time limit). Read only when `?testHooks=1` is present; the value is a
 * JSON object deep-merged into the default GameConfig. Rules and systems are
 * unchanged: this is exactly the "adjustable typed config" a designer uses.
 */
export const TEST_CONFIG_OVERRIDES_KEY = 'pirate-battle:test-config-overrides';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge(base: Json, patch: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isObject(current) && isObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

export function baseConfigWithTestOverrides(): GameConfig {
  try {
    const raw = window.localStorage.getItem(TEST_CONFIG_OVERRIDES_KEY);
    if (!raw) return DEFAULT_GAME_CONFIG;
    const patch: unknown = JSON.parse(raw);
    if (!isObject(patch)) return DEFAULT_GAME_CONFIG;
    return deepMerge(DEFAULT_GAME_CONFIG as unknown as Json, patch) as unknown as GameConfig;
  } catch {
    return DEFAULT_GAME_CONFIG;
  }
}
