import { act, renderHook, waitFor } from '@testing-library/react';

import {
  type TmdbPlaybackTarget,
  findTmdbEpisodeSource,
  loadNextTmdbEpisode,
} from '@/features/tmdb/lib/next-episode';
import { isTmdbSubjectEntryEnabled } from '@/lib/subject-navigation';
import type { SearchResult, TmdbEpisodeCoordinate } from '@/lib/types';

import { useTmdbNextEpisode } from './useTmdbNextEpisode';

jest.mock('@/features/tmdb/lib/next-episode', () => ({
  ...jest.requireActual('@/features/tmdb/lib/next-episode'),
  findTmdbEpisodeSource: jest.fn(),
  loadNextTmdbEpisode: jest.fn(),
}));
jest.mock('@/features/tmdb/lib/playback-coordinate', () => ({
  resolveTmdbPlaybackCoordinate: jest.fn(),
}));
jest.mock('@/lib/subject-navigation', () => ({
  ...jest.requireActual('@/lib/subject-navigation'),
  isTmdbSubjectEntryEnabled: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({
  showToast: jest.fn(),
  dismissToast: jest.fn(),
}));
const detail: SearchResult = {
  source: 'a',
  id: 'a',
  source_name: 'A',
  title: '测试剧',
  year: '2024',
  poster: '',
  episodes: ['url1', 'url3'],
  episodes_titles: ['第1集', '第3集'],
};
const coordinate: TmdbEpisodeCoordinate = {
  media_key: 'tv/1',
  season: 1,
  episode: 1,
  source: 'a',
  video_id: 'a',
  source_episode_index: 1,
};
const target: TmdbPlaybackTarget = {
  mediaKey: 'tv/1',
  title: '测试剧',
  year: '2024',
  target: {
    season: 1,
    episode: 2,
    seasonEpisodeCount: 3,
    priorEpisodes: 0,
    airDate: '',
    episodeName: '',
    strippedTitle: '测试剧',
    showYear: '2024',
  },
};
function setup() {
  const options: Parameters<typeof useTmdbNextEpisode>[0] = {
    detail,
    episodeIndex: 0,
    detailRef: { current: detail },
    episodeIndexRef: { current: 0 },
    coordinateRef: { current: coordinate },
    availableSources: [],
    saveProgress: jest.fn().mockResolvedValue(undefined),
    resetPlaybackIntent: jest.fn(),
    switchEpisode: jest.fn(),
    changeSource: jest.fn().mockResolvedValue(undefined),
    navigate: jest.fn(),
  };
  return { options, ...renderHook(() => useTmdbNextEpisode(options)) };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isTmdbSubjectEntryEnabled).mockReturnValue(true);
  jest.mocked(loadNextTmdbEpisode).mockResolvedValue(target);
  jest.mocked(findTmdbEpisodeSource).mockResolvedValue(null);
});
it('关闭 TMDB 时把下一集交回旧路径，不读坐标或搜索', () => {
  jest.mocked(isTmdbSubjectEntryEnabled).mockReturnValue(false);
  const view = setup();
  expect(view.result.current.advance()).toBe(false);
  expect(loadNextTmdbEpisode).not.toHaveBeenCalled();
});
it('缺集时跳到目标集的详情校验页，不按数组下标跳到第三集', async () => {
  const view = setup();
  act(() => {
    expect(view.result.current.advance()).toBe(true);
  });
  await waitFor(() => expect(view.options.navigate).toHaveBeenCalled());
  const url = new URL(
    jest.mocked(view.options.navigate).mock.calls[0][0],
    'http://localhost',
  );
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    tmdbId: '1',
    season: '1',
    episode: '2',
    verify: '1',
  });
  expect(view.options.switchEpisode).not.toHaveBeenCalled();
});
it('跨源匹配交给统一换源流程，重复触发只搜索一次', async () => {
  const next = {
    ...detail,
    source: 'b',
    id: 'b',
    episodes: ['url2'],
    episodes_titles: ['第2集'],
  };
  jest
    .mocked(findTmdbEpisodeSource)
    .mockResolvedValue({ detail: next, episodeIndex: 0 });
  const view = setup();
  act(() => {
    view.result.current.advance();
    view.result.current.advance();
  });
  await waitFor(() =>
    expect(view.options.changeSource).toHaveBeenCalledWith('b', 'b', '测试剧', {
      nextEpisode: target,
      detail: next,
    }),
  );
  expect(findTmdbEpisodeSource).toHaveBeenCalledTimes(1);
  expect(view.options.saveProgress).toHaveBeenCalledTimes(1);
});
it('同源换线路或集时明确从头播放', async () => {
  const next = { ...detail, episodes: ['url2'], episodes_titles: ['第2集'] };
  jest
    .mocked(findTmdbEpisodeSource)
    .mockResolvedValue({ detail: next, episodeIndex: 0 });
  const view = setup();
  act(() => {
    view.result.current.advance();
  });
  await waitFor(() =>
    expect(view.options.switchEpisode).toHaveBeenCalledWith(0, next, {
      fromStart: true,
    }),
  );
  expect(view.options.coordinateRef.current).toMatchObject({ episode: 2 });
});
it('用户换集或退出作废迟到结果', async () => {
  let finish!: (value: TmdbPlaybackTarget) => void;
  jest.mocked(loadNextTmdbEpisode).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = setup();
  act(() => {
    view.result.current.advance();
    view.result.current.cancel();
  });
  await act(async () => {
    finish(target);
  });
  expect(findTmdbEpisodeSource).not.toHaveBeenCalled();
  expect(view.options.navigate).not.toHaveBeenCalled();
  expect(view.options.changeSource).not.toHaveBeenCalled();
});
it('全剧末尾不搜索片源，也不跳转死链', async () => {
  jest.mocked(loadNextTmdbEpisode).mockResolvedValue(null);
  const view = setup();
  await act(async () => {
    view.result.current.advance();
  });
  expect(findTmdbEpisodeSource).not.toHaveBeenCalled();
  expect(view.options.navigate).not.toHaveBeenCalled();
});
