import { readStorage, writeStorage } from '@/lib/browser-storage';

export const PLAYER_BUFFER_PREFERENCES_KEY = 'playerBufferPreferences';
export const PLAYER_BUFFER_PREFERENCES_EVENT =
  'icetv:player-buffer-preferences-change';

export const PLAYER_BUFFER_OPTIONS = {
  startupBufferSeconds: [0, 1, 3, 5, 10],
  forwardBufferSeconds: [0, 30, 60, 120, 300],
  fragmentConcurrency: [1, 2, 4],
} as const;

export type PlayerBufferPreferences = {
  startupBufferSeconds: number;
  forwardBufferSeconds: number;
  fragmentConcurrency: number;
};

const DEFAULTS: PlayerBufferPreferences = {
  startupBufferSeconds: 0,
  forwardBufferSeconds: 0,
  fragmentConcurrency: 1,
};

export function normalizePlayerBufferPreferences(
  value: unknown,
): PlayerBufferPreferences {
  const input = value as Partial<PlayerBufferPreferences> | null;
  const result = { ...DEFAULTS };
  for (const key of Object.keys(
    DEFAULTS,
  ) as (keyof PlayerBufferPreferences)[]) {
    const candidate = input?.[key];
    if (
      typeof candidate === 'number' &&
      (PLAYER_BUFFER_OPTIONS[key] as readonly number[]).includes(candidate)
    ) {
      result[key] = candidate;
    }
  }
  return result;
}

export function readPlayerBufferPreferences(): PlayerBufferPreferences {
  try {
    return normalizePlayerBufferPreferences(
      JSON.parse(readStorage(PLAYER_BUFFER_PREFERENCES_KEY) ?? 'null'),
    );
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePlayerBufferPreferences(
  preferences: PlayerBufferPreferences,
): boolean {
  return writeStorage(
    PLAYER_BUFFER_PREFERENCES_KEY,
    JSON.stringify(normalizePlayerBufferPreferences(preferences)),
  );
}
