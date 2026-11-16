import type {
  TmdbEpisode,
  TmdbSeasonDetail,
  TmdbShowDetail,
} from '@/features/tmdb/types';
import type { SearchResult, TmdbEpisodeCoordinate } from '@/lib/types';

import {
  type TmdbPlaybackTarget,
  buildTmdbVerificationUrl,
  findTmdbEpisodeSource,
  loadNextTmdbEpisode,
  matchTmdbPlaybackTarget,
} from '../next-episode';
import { resolveTmdbNextPreloadUrl } from '../next-episode';
import {
  fetchTmdbSeasonDetail,
  fetchTmdbShowDetail,
  resolveTmdbClientSettings,
} from '../tmdb-client';

jest.mock('../tmdb-client', () => ({
  fetchTmdbShowDetail: jest.fn(),
  fetchTmdbSeasonDetail: jest.fn(),
  resolveTmdbClientSettings: jest.fn(),
}));
const coordinate: TmdbEpisodeCoordinate = {
  media_key: 'tv/95842',
  season: 1,
  episode: 1,
  source: 'a',
  video_id: 'a',
  source_episode_index: 1,
};
const target: TmdbPlaybackTarget = {
  mediaKey: 'tv/95842',
  title: '测试剧',
  year: '2024',
  target: {
    season: 1,
    episode: 2,
    airDate: '',
    episodeName: '',
    seasonEpisodeCount: 3,
    priorEpisodes: 0,
    strippedTitle: '测试剧',
    showYear: '2024',
  },
};
function source(key: string, numbers: number[]): SearchResult {
  return {
    source: key,
    id: key,
    source_name: key,
    title: '测试剧',
    year: '2024',
    poster: '',
    episodes: numbers.map((n) => `https://${key}.example/${n}.mp4`),
    episodes_titles: numbers.map((n) => `第${n}集`),
  };
}
function season(n: number): TmdbSeasonDetail {
  return {
    showId: 95842,
    seasonNumber: n,
    name: '',
    airDate: null,
    episodes: [1, 2, 3].map(
      (ep) =>
        ({
          id: n * 10 + ep,
          episode_number: ep,
          season_number: n,
          name: '',
          air_date: '2024-01-01',
        }) as TmdbEpisode,
    ),
  };
}
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(resolveTmdbClientSettings).mockReturnValue({
    apiBase: 'http://example.com',
    apiKey: 'test',
    imageBase: 'http://example.com',
    bearerAuth: false,
  });
  jest.mocked(fetchTmdbShowDetail).mockResolvedValue({
    id: 95842,
    name: '测试剧',
    first_air_date: '2024-01-01',
    seasons: [1, 2].map((n) => ({
      season_number: n,
      episode_count: 3,
      name: `第${n}季`,
    })),
  } as TmdbShowDetail);
  jest
    .mocked(fetchTmdbSeasonDetail)
    .mockImplementation(async (_settings, _id, n) => season(n));
});
it('坐标预载仅准备当前源确认的下一集，缺集时不预载第三集', async () => {
  const signal = new AbortController().signal;
  expect(
    await resolveTmdbNextPreloadUrl(
      source('a', [1, 2, 3]),
      0,
      coordinate,
      signal,
    ),
  ).toBe('https://a.example/2.mp4');
  expect(
    await resolveTmdbNextPreloadUrl(source('a', [1, 3]), 0, coordinate, signal),
  ).toBeNull();
});

it('同季下一集与季末跨季按 TMDB 坐标决定', async () => {
  expect((await loadNextTmdbEpisode(coordinate))?.target).toMatchObject({
    season: 1,
    episode: 2,
    priorEpisodes: 0,
  });
  expect(
    (await loadNextTmdbEpisode({ ...coordinate, episode: 3 }))?.target,
  ).toMatchObject({ season: 2, episode: 1, priorEpisodes: 3 });
  expect(
    await loadNextTmdbEpisode({ ...coordinate, season: 2, episode: 3 }),
  ).toBeNull();
});
it('未播下一集不跳过，电影没有自动下一集', async () => {
  const future = season(1);
  future.episodes[1].air_date = '2999-01-01';
  jest.mocked(fetchTmdbSeasonDetail).mockResolvedValue(future);
  expect(await loadNextTmdbEpisode(coordinate)).toBeNull();
  expect(
    await loadNextTmdbEpisode({
      ...coordinate,
      media_key: 'movie/1',
      season: 0,
    }),
  ).toBeNull();
});
it('当前源即使后一个数组元素是第三集也不会跳集', async () => {
  const current = source('a', [1, 3]);
  const other = source('b', [3, 2, 1]);
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => other });
  const result = await findTmdbEpisodeSource(
    target,
    current,
    [other],
    new AbortController().signal,
  );
  expect(result?.detail.source).toBe('b');
  expect(result?.episodeIndex).toBe(1);
});
it('同源其他线路可提供目标集，匹配线路无需跨源', () => {
  const current = source('a', [1, 3]);
  const next = source('b', [2]);
  current.playback_lines = [
    {
      key: 'b',
      label: '高清',
      episodes: next.episodes,
      episodes_titles: next.episodes_titles,
    },
  ];
  expect(matchTmdbPlaybackTarget(current, target)).toMatchObject({
    episodeIndex: 0,
    detail: { source: 'a', playback_line: 'b' },
  });
});
it('已知源都缺集后只走一次现有聚合搜索，拒绝无关片和空地址', async () => {
  const current = source('a', [1]);
  const candidate = source('b', [2]);
  const invalid = { ...source('bad', [2]), title: '其他剧' };
  global.fetch = jest.fn(async (url) =>
    String(url).startsWith('/api/search')
      ? { ok: true, json: async () => ({ results: [invalid, candidate] }) }
      : {
          ok: true,
          json: async () =>
            String(url).includes('source=bad') ? invalid : candidate,
        },
  ) as unknown as typeof fetch;
  expect(
    (
      await findTmdbEpisodeSource(
        target,
        current,
        [],
        new AbortController().signal,
      )
    )?.detail.source,
  ).toBe('b');
  expect(
    jest
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).startsWith('/api/search')),
  ).toHaveLength(1);
  expect(
    matchTmdbPlaybackTarget({ ...candidate, episodes: [''] }, target),
  ).toBeNull();
});
it('全部缺集返回空，校验 URL 保留作品与精确目标季集', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
  expect(
    await findTmdbEpisodeSource(
      target,
      source('a', [1]),
      [],
      new AbortController().signal,
    ),
  ).toBeNull();
  const url = new URL(buildTmdbVerificationUrl(target), 'http://localhost');
  expect(url.pathname).toBe('/subject');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    tmdbId: '95842',
    season: '1',
    episode: '2',
    verify: '1',
  });
});
it('取消后不再搜索或提交候选', async () => {
  const controller = new AbortController();
  controller.abort();
  global.fetch = jest.fn();
  expect(
    await findTmdbEpisodeSource(
      target,
      source('a', [1]),
      [],
      controller.signal,
    ),
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
