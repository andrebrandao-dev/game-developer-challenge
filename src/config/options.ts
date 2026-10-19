import { z } from 'zod';
import { DEFAULT_PLAYER_OPTIONS, OPTION_LIMITS, type PlayerOptions } from './gameConfig';

export type OptionKey = keyof typeof OPTION_LIMITS;
export type OptionErrors = Partial<Record<OptionKey, string>>;

const isOnStep = (value: number, min: number, step: number): boolean => {
  const n = (value - min) / step;
  return Math.abs(n - Math.round(n)) < 1e-9;
};

/** Validates one option value. Returns an error message or null. */
export function validateOption(key: OptionKey, value: number): string | null {
  const limits = OPTION_LIMITS[key];
  const unit = 'seconds';
  if (!Number.isFinite(value)) return 'Enter a number.';
  if (value <= 0) return 'Must be greater than 0.';
  if (value < limits.min || value > limits.max) return `Must be between ${limits.min} and ${limits.max} ${unit}.`;
  if (!isOnStep(value, limits.min, limits.step)) return `Use steps of ${limits.step} ${unit}.`;
  return null;
}

export function validateOptions(values: Record<OptionKey, number>): OptionErrors {
  const errors: OptionErrors = {};
  for (const key of Object.keys(OPTION_LIMITS) as OptionKey[]) {
    const error = validateOption(key, values[key]);
    if (error) errors[key] = error;
  }
  return errors;
}

const refineOption = (key: OptionKey) => z.number().refine((v) => validateOption(key, v) === null);

/** Schema for persisted options; invalid stored values fall back to defaults. */
export const playerOptionsSchema: z.ZodType<PlayerOptions> = z.object({
  sessionDurationSec: refineOption('sessionDurationSec'),
  spawnIntervalSec: refineOption('spawnIntervalSec'),
});

export { DEFAULT_PLAYER_OPTIONS, OPTION_LIMITS };
