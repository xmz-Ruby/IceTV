import type Artplayer from 'artplayer';

import { createArtPlayerSettings } from '@/features/play/lib/artPlayerSettings';
import {
  writeAutoPlayNextEnabled,
  writeBlockAdEnabled,
} from '@/lib/local-preferences';
import {
  PLAYER_BUFFER_PREFERENCES_EVENT,
  readPlayerBufferPreferences,
  writePlayerBufferPreferences,
} from '@/lib/player-buffer-preferences';
import { runManagedVideoCleanup } from '@/lib/player-runtime';
import { showToast } from '@/lib/toast';

jest.mock('@/lib/local-preferences', () => ({
  writeAutoPlayNextEnabled: jest.fn(),
  writeBlockAdEnabled: jest.fn(),
}));
jest.mock('@/lib/player-buffer-preferences', () => ({
  ...jest.requireActual('@/lib/player-buffer-preferences'),
  readPlayerBufferPreferences: jest.fn(() => ({
    startupBufferSeconds: 0,
    forwardBufferSeconds: 0,
    fragmentConcurrency: 1,
  })),
  writePlayerBufferPreferences: jest.fn(() => true),
}));
jest.mock('@/lib/player-runtime', () => ({
  destroyManagedHls: jest.fn(),
  runManagedVideoCleanup: jest.fn(),
}));
jest.mock('@/lib/player-utils', () => ({
  destroyArtPlayer: jest.fn(),
  formatTime: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
it('去广告重建失败恢复原开关与偏好并提示', () => {
  jest.mocked(writeBlockAdEnabled).mockReturnValue(true);
  jest.mocked(runManagedVideoCleanup).mockImplementation(() => {
    throw new Error('internal');
  });
  const setBlockAdEnabled = jest.fn();
  const settings = createArtPlayerSettings({
    artPlayerRef: { current: { currentTime: 10, video: {} } as Artplayer },
    blockAdEnabled: true,
    autoPlayNextEnabled: true,
    autoPlayNextEnabledRef: { current: true },
    skipConfigRef: { current: { enable: false, intro_time: 0, outro_time: 0 } },
    resumeTimeRef: { current: null },
    resumeModeRef: { current: 'forced' },
    setBlockAdEnabled,
    setAutoPlayNextEnabled: jest.fn(),
    handleSkipConfigChange: jest.fn(),
  });
  expect(
    'onSwitch' in settings[0] && settings[0].onSwitch?.({ switch: true }),
  ).toBe(true);
  expect(setBlockAdEnabled).toHaveBeenCalledWith(true);
  expect(writeBlockAdEnabled).toHaveBeenLastCalledWith(true);
  expect(showToast).toHaveBeenCalledWith('去广告设置未能生效，请重试', 'error');
  expect(writeAutoPlayNextEnabled).not.toHaveBeenCalled();
});

it('缓冲菜单合并三项偏好并通知当前播放器，存储失败会提示', () => {
  jest.mocked(readPlayerBufferPreferences).mockReturnValue({
    startupBufferSeconds: 3,
    forwardBufferSeconds: 60,
    fragmentConcurrency: 1,
  });
  const listener = jest.fn();
  window.addEventListener(PLAYER_BUFFER_PREFERENCES_EVENT, listener);
  const settings = createArtPlayerSettings({
    artPlayerRef: { current: null },
    blockAdEnabled: false,
    autoPlayNextEnabled: true,
    autoPlayNextEnabledRef: { current: true },
    skipConfigRef: { current: { enable: false, intro_time: 0, outro_time: 0 } },
    resumeTimeRef: { current: null },
    resumeModeRef: { current: null },
    setBlockAdEnabled: jest.fn(),
    setAutoPlayNextEnabled: jest.fn(),
    handleSkipConfigChange: jest.fn(),
    hlsPlayback: true,
  });
  const startup = settings.find((item) => item.name === 'startupBufferSeconds');
  const concurrency = settings.find(
    (item) => item.name === 'fragmentConcurrency',
  );
  expect(startup && 'tooltip' in startup && startup.tooltip).toBe('3 秒');
  expect(
    concurrency &&
      'onSelect' in concurrency &&
      concurrency.onSelect({ value: 4 }),
  ).toBe('4 个');
  expect(writePlayerBufferPreferences).toHaveBeenLastCalledWith({
    startupBufferSeconds: 3,
    forwardBufferSeconds: 60,
    fragmentConcurrency: 4,
  });
  expect(listener.mock.calls[0][0].detail.fragmentConcurrency).toBe(4);
  jest.mocked(writePlayerBufferPreferences).mockReturnValueOnce(false);
  expect(
    startup && 'onSelect' in startup && startup.onSelect({ value: 5 }),
  ).toBe('5 秒');
  expect(showToast).toHaveBeenCalledWith(
    '设置未能保存，重新加载后会恢复',
    'error',
    { key: 'local-preference-save' },
  );
  window.removeEventListener(PLAYER_BUFFER_PREFERENCES_EVENT, listener);
});
