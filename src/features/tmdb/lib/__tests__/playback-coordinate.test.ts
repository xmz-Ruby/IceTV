import { resolveTmdbPlaybackCoordinate } from '@/features/tmdb/lib/playback-coordinate';
import {
  fetchTmdbMovieDetail,
  fetchTmdbSeasonDetail,
  fetchTmdbShowDetail,
  resolveBestTmdbMatch,
  resolveTmdbClientSettings,
} from '@/features/tmdb/lib/tmdb-client';
import type { TmdbSeasonDetail, TmdbShowDetail } from '@/features/tmdb/types';
import { getTmdbWatchProgressBySource } from '@/lib/db.client';
import type { SearchResult, TmdbEpisodeCoordinate } from '@/lib/types';

jest.mock('@/features/tmdb/lib/tmdb-client', () => ({
  fetchTmdbMovieDetail: jest.fn(),
  fetchTmdbSeasonDetail: jest.fn(),
  fetchTmdbShowDetail: jest.fn(),
  resolveBestTmdbMatch: jest.fn(),
  resolveTmdbClientSettings: jest.fn(),
}));
jest.mock('@/lib/db.client', () => ({
  getTmdbWatchProgressBySource: jest.fn(),
}));

const hint: TmdbEpisodeCoordinate = {
  media_key: 'tv/95842',
  season: 2,
  episode: 1,
  source: 'src',
  video_id: 'vid',
  source_episode_index: 3,
};
const source: SearchResult = {
  source: 'src',
  id: 'vid',
  source_name: 'Source',
  title: '测试剧',
  year: '2024',
  poster: '',
  episodes: ['url1', 'url2', 'url3', 'url4'],
  episodes_titles: ['第1集', '第2集', '第3集', '第4集'],
};
const show: TmdbShowDetail = {
  id: 95842,
  name: '测试剧',
  original_name: 'Show',
  overview: '',
  first_air_date: '2024-01-01',
  poster_path: null,
  backdrop_path: null,
  vote_average: 0,
  vote_count: 0,
  genres: [],
  status: '',
  number_of_seasons: 2,
  number_of_episodes: 4,
  seasons: [1, 2].map((n) => ({
    id: n,
    name: `第${n}季`,
    season_number: n,
    air_date: `${2023 + n}-01-01`,
    episode_count: 2,
    overview: '',
    poster_path: null,
  })),
};
function season(n: number): TmdbSeasonDetail {
  return {
    showId: show.id,
    seasonNumber: n,
    name: `第${n}季`,
    airDate: null,
    episodes: [1, 2].map((episode) => ({
      id: n * 10 + episode,
      name: `季${n}剧集${episode}`,
      overview: '',
      episode_number: episode,
      season_number: n,
      air_date: null,
      still_path: null,
      runtime: null,
      vote_average: 0,
    })),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(resolveTmdbClientSettings).mockReturnValue({
    apiBase: 'https://tmdb.example/3',
    imageBase: 'https://tmdb.example/t/p',
    apiKey: 'test',
    bearerAuth: false,
  });
  jest.mocked(getTmdbWatchProgressBySource).mockResolvedValue([]);
  jest.mocked(resolveBestTmdbMatch).mockResolvedValue({
    status: 'ok',
    strippedTitle: '测试剧',
    match: {
      id: 95842,
      mediaType: 'tv',
      name: '测试剧',
      originalName: 'Show',
      firstAirDate: '2024-01-01',
      overview: '',
      posterPath: null,
      score: 80,
    },
  });
  jest.mocked(fetchTmdbShowDetail).mockResolvedValue(show);
  jest
    .mocked(fetchTmdbSeasonDetail)
    .mockImplementation(async (_settings, _id, n) => season(n));
});

it('未启用时不读取历史或访问 TMDB', async () => {
  jest.mocked(resolveTmdbClientSettings).mockReturnValue(null);
  expect(await resolveTmdbPlaybackCoordinate(source, 0, hint)).toBeNull();
  expect(getTmdbWatchProgressBySource).not.toHaveBeenCalled();
  expect(resolveBestTmdbMatch).not.toHaveBeenCalled();
});

it('详情页坐标固定作品身份，按当前集反查而非一直写入选中的旧集', async () => {
  const detail = {
    ...source,
    title: '测试剧 第二季',
    episodes: ['url1', 'url2'],
    episodes_titles: ['第1集', '第2集'],
  };
  expect(await resolveTmdbPlaybackCoordinate(detail, 1, hint)).toEqual({
    ...hint,
    episode: 2,
    source_episode_index: 2,
  });
  expect(getTmdbWatchProgressBySource).not.toHaveBeenCalled();
  expect(resolveBestTmdbMatch).not.toHaveBeenCalled();
});

it('分组源的第三个数组元素是第二季第一集', async () => {
  const detail = {
    ...source,
    episode_groups: [
      { label: '第一季', count: 2 },
      { label: '第二季', count: 2 },
    ],
  };
  expect(await resolveTmdbPlaybackCoordinate(detail, 2, hint)).toEqual(hint);
});

it('直进播放优先找回已知作品，并换算连播绝对集号', async () => {
  jest
    .mocked(getTmdbWatchProgressBySource)
    .mockResolvedValue([
      { ...hint, position: 60, duration: 1500, updated_at: 1 },
    ]);
  expect(await resolveTmdbPlaybackCoordinate(source, 3)).toEqual({
    ...hint,
    episode: 2,
    source_episode_index: 4,
  });
  expect(resolveBestTmdbMatch).not.toHaveBeenCalled();
});

it('首次直进播放复用标题匹配，无匹配时不生成坐标', async () => {
  expect(await resolveTmdbPlaybackCoordinate(source, 0)).toEqual({
    ...hint,
    season: 1,
    episode: 1,
    source_episode_index: 1,
  });
  expect(resolveBestTmdbMatch).toHaveBeenCalledWith(
    source.title,
    source.year,
    'tv',
    undefined,
  );
  jest
    .mocked(resolveBestTmdbMatch)
    .mockResolvedValue({ status: 'no-match', match: null, strippedTitle: '' });
  expect(await resolveTmdbPlaybackCoordinate(source, 0)).toBeNull();
});

it('同源条目变成其他作品时不沿用已有坐标', async () => {
  expect(
    await resolveTmdbPlaybackCoordinate(
      { ...source, title: '另一部剧' },
      2,
      hint,
    ),
  ).toBeNull();
});

it('一个源集能对应多个 TMDB 集时放弃写入', async () => {
  const episodes = season(1);
  episodes.episodes.forEach((item) => {
    item.name = '特殊集名';
  });
  jest.mocked(fetchTmdbSeasonDetail).mockResolvedValue(episodes);
  expect(
    await resolveTmdbPlaybackCoordinate(
      {
        ...source,
        title: '测试剧 第一季',
        episodes: ['url1', 'url2'],
        episodes_titles: ['特殊集名', '其他'],
      },
      0,
      hint,
    ),
  ).toBeNull();
});

it('取消后不继续读取季详情', async () => {
  const controller = new AbortController();
  jest.mocked(fetchTmdbShowDetail).mockImplementation(async () => {
    controller.abort();
    return show;
  });
  expect(
    await resolveTmdbPlaybackCoordinate(source, 0, hint, controller.signal),
  ).toBeNull();
  expect(fetchTmdbSeasonDetail).not.toHaveBeenCalled();
});

it('电影统一写入 movie/id 的 0 季 1 集', async () => {
  jest.mocked(fetchTmdbMovieDetail).mockResolvedValue({
    id: 399566,
    title: '测试电影',
    release_date: '2024-01-01',
  } as Awaited<ReturnType<typeof fetchTmdbMovieDetail>>);
  const movie = {
    ...source,
    title: '测试电影',
    episodes: ['url1'],
    episodes_titles: ['正片'],
  };
  expect(
    await resolveTmdbPlaybackCoordinate(movie, 0, {
      ...hint,
      media_key: 'movie/399566',
      season: 0,
      episode: 1,
      source_episode_index: 1,
    }),
  ).toEqual({
    ...hint,
    media_key: 'movie/399566',
    season: 0,
    episode: 1,
    source_episode_index: 1,
  });
});
