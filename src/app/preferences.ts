import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { DEFAULT_PLAYER_OPTIONS, type PlayerOptions } from '@/config/gameConfig';
import { playerOptionsSchema } from '@/config/options';
import { ValueStore } from '@/lib/store';
import { readJson, writeJson } from '@/persistence/storage';

export const STORAGE_KEYS = {
  options: 'pirate-battle:options:v1',
  profile: 'pirate-battle:profile:v1',
  lastResult: 'pirate-battle:last-result:v1',
} as const;

// ------------------------------------------------------------- options

export const optionsStore = new ValueStore<PlayerOptions>(
  readJson(STORAGE_KEYS.options, playerOptionsSchema, DEFAULT_PLAYER_OPTIONS),
);

export function saveOptions(options: PlayerOptions): boolean {
  const parsed = playerOptionsSchema.safeParse(options);
  if (!parsed.success) return false;
  const ok = writeJson(STORAGE_KEYS.options, parsed.data);
  optionsStore.set({ ...parsed.data });
  return ok;
}

export const useOptions = (): PlayerOptions => useSyncExternalStore(optionsStore.subscribe, optionsStore.get);

// ------------------------------------------------------------- profile

export const NAME_LIMITS = { min: 2, max: 20 } as const;

export interface PlayerProfile {
  playerId: string;
  name: string;
}

const profileSchema = z.object({
  playerId: z.string().min(8),
  name: z.string().trim().min(NAME_LIMITS.min).max(NAME_LIMITS.max),
});

function createProfile(): PlayerProfile {
  const profile = { playerId: crypto.randomUUID(), name: 'Captain Jack' };
  writeJson(STORAGE_KEYS.profile, profile);
  return profile;
}

const storedProfile = readJson<PlayerProfile | null>(STORAGE_KEYS.profile, profileSchema, null);
export const profileStore = new ValueStore<PlayerProfile>(storedProfile ?? createProfile());

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < NAME_LIMITS.min || trimmed.length > NAME_LIMITS.max) {
    return `Use ${NAME_LIMITS.min} to ${NAME_LIMITS.max} characters.`;
  }
  return null;
}

export function saveProfileName(name: string): boolean {
  if (validateName(name)) return false;
  const next = { ...profileStore.get(), name: name.trim() };
  profileStore.set(next);
  return writeJson(STORAGE_KEYS.profile, next);
}

export const useProfile = (): PlayerProfile => useSyncExternalStore(profileStore.subscribe, profileStore.get);
