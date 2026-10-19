import type { z } from 'zod';

/**
 * localStorage helpers with schema validation. Corrupted, outdated or
 * unavailable storage (private mode, quota) falls back to defaults instead of
 * breaking the app.
 */
export function readJson<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}
