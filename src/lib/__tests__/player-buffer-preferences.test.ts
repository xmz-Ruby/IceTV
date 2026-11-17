import { readStorage, writeStorage } from '@/lib/browser-storage';
import {
  normalizePlayerBufferPreferences,
  PLAYER_BUFFER_PREFERENCES_KEY,
  readPlayerBufferPreferences,
  writePlayerBufferPreferences,
} from '@/lib/player-buffer-preferences';

jest.mock('@/lib/browser-storage', () => ({
  readStorage: jest.fn(),
  writeStorage: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(readStorage).mockReturnValue(null);
  jest.mocked(writeStorage).mockReturnValue(true);
});

it('defaults to immediate startup, automatic forward buffer and sequential loading', () => {
  expect(readPlayerBufferPreferences()).toEqual({
    startupBufferSeconds: 0,
    forwardBufferSeconds: 0,
    fragmentConcurrency: 1,
  });
});

it('reads saved choices and rejects invalid fields independently', () => {
  jest.mocked(readStorage).mockReturnValue(
    JSON.stringify({
      startupBufferSeconds: 5,
      forwardBufferSeconds: 300,
      fragmentConcurrency: 4,
    }),
  );
  expect(readPlayerBufferPreferences()).toEqual({
    startupBufferSeconds: 5,
    forwardBufferSeconds: 300,
    fragmentConcurrency: 4,
  });
  expect(
    normalizePlayerBufferPreferences({
      startupBufferSeconds: '5',
      forwardBufferSeconds: -1,
      fragmentConcurrency: 4,
    }),
  ).toEqual({
    startupBufferSeconds: 0,
    forwardBufferSeconds: 0,
    fragmentConcurrency: 4,
  });
  jest.mocked(readStorage).mockReturnValue('{broken');
  expect(readPlayerBufferPreferences().fragmentConcurrency).toBe(1);
});

it('reports storage failure and writes only supported preferences', () => {
  jest.mocked(writeStorage).mockReturnValue(false);
  expect(
    writePlayerBufferPreferences({
      startupBufferSeconds: 3,
      forwardBufferSeconds: Infinity,
      fragmentConcurrency: 200,
    }),
  ).toBe(false);
  expect(writeStorage).toHaveBeenCalledWith(
    PLAYER_BUFFER_PREFERENCES_KEY,
    JSON.stringify({
      startupBufferSeconds: 3,
      forwardBufferSeconds: 0,
      fragmentConcurrency: 1,
    }),
  );
});
