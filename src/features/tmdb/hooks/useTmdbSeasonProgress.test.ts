import { act, renderHook, waitFor } from '@testing-library/react';

import {
  getTmdbWatchProgressByMediaKey,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import type { TmdbWatchProgress } from '@/lib/types';

import { useTmdbSeasonProgress } from './useTmdbSeasonProgress';

jest.mock('@/lib/db.client', () => ({
  getTmdbWatchProgressByMediaKey: jest.fn(),
  subscribeToDataUpdates: jest.fn(() => jest.fn()),
}));
beforeEach(() => jest.clearAllMocks());
it('切季后不显示旧季数据，迟到请求不会覆盖新季', async () => {
  let first!: (rows: TmdbWatchProgress[]) => void;
  jest
    .mocked(getTmdbWatchProgressByMediaKey)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          first = resolve;
        }),
    )
    .mockResolvedValueOnce([{ episode: 2, season: 2 } as TmdbWatchProgress]);
  const view = renderHook(
    ({ season }) => useTmdbSeasonProgress('tv/1', season),
    { initialProps: { season: 1 } },
  );
  view.rerender({ season: 2 });
  await waitFor(() => expect(view.result.current.progress[0]?.season).toBe(2));
  await act(async () =>
    first([{ episode: 1, season: 1 } as TmdbWatchProgress]),
  );
  expect(view.result.current.progress[0].season).toBe(2);
});
it('失败可重试，收到播放记录更新后刷新', async () => {
  jest
    .mocked(getTmdbWatchProgressByMediaKey)
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValue([]);
  const view = renderHook(() => useTmdbSeasonProgress('tv/1', 1));
  await waitFor(() => expect(view.result.current.progressError).toBe(true));
  act(() => view.result.current.retryProgress());
  await waitFor(() => expect(view.result.current.progressError).toBe(false));
  act(() => jest.mocked(subscribeToDataUpdates).mock.calls[0][1]({}));
  await waitFor(() =>
    expect(getTmdbWatchProgressByMediaKey).toHaveBeenCalledTimes(3),
  );
});
