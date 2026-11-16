/** @jest-environment node */
import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

installWebPolyfills();
jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
  isGuardFailure: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    getTmdbWatchProgressByMediaKey: jest.fn(),
    getTmdbWatchProgressBySource: jest.fn(),
  },
}));

const { GET } = require('./route') as typeof import('./route');

const row = {
  media_key: 'tv/95842',
  season: 2,
  episode: 1,
  source: 'src',
  video_id: 'id',
  source_episode_index: 13,
  position: 600,
  duration: 1500,
  updated_at: 1000,
};
function request(query: string) {
  return new Request(
    `http://localhost/api/tmdb/history?${query}`,
  ) as NextRequest;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requireActiveUser).mockResolvedValue({
    username: 'alice',
    role: 'user',
    isOwner: false,
  } as Awaited<ReturnType<typeof requireActiveUser>>);
  jest.mocked(isGuardFailure).mockReturnValue(false);
  jest.mocked(db.getTmdbWatchProgressByMediaKey).mockResolvedValue([row]);
  jest.mocked(db.getTmdbWatchProgressBySource).mockResolvedValue([row]);
});

it('只按登录用户和指定季读取，响应不缓存', async () => {
  const response = await GET(
    request('mediaKey=tv%2F95842&season=2&username=bob'),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ items: [row], nextEpisode: null });
  expect(db.getTmdbWatchProgressByMediaKey).toHaveBeenCalledWith(
    'alice',
    'tv/95842',
    2,
    0,
  );
  expect(response.headers.get('cache-control')).toContain('no-store');
});

it('下一页游标取最后一条实际返回集号', async () => {
  jest.mocked(db.getTmdbWatchProgressByMediaKey).mockResolvedValue(
    Array.from({ length: 101 }, (_, index) => ({
      ...row,
      episode: index + 101,
    })),
  );
  const response = await GET(
    request('mediaKey=tv%2F95842&season=2&afterEpisode=100'),
  );
  const page = await response.json();
  expect(page.items).toHaveLength(100);
  expect(page.nextEpisode).toBe(200);
  expect(db.getTmdbWatchProgressByMediaKey).toHaveBeenCalledWith(
    'alice',
    'tv/95842',
    2,
    100,
  );
});

it('直进播放按源和条目读取最近坐标', async () => {
  const response = await GET(request('source=src&id=id&username=bob'));
  expect(await response.json()).toEqual([row]);
  expect(db.getTmdbWatchProgressBySource).toHaveBeenCalledWith(
    'alice',
    'src',
    'id',
  );
});

it.each([
  '',
  'source=src',
  'id=id',
  'mediaKey=invalid&season=1',
  'mediaKey=tv%2F0&season=1',
  'mediaKey=tv%2F1',
  'mediaKey=tv%2F1&season=-1',
  'mediaKey=tv%2F1&season=1000',
  'mediaKey=movie%2F1&season=1',
  'mediaKey=tv%2F1&season=1&afterEpisode=NaN',
  'mediaKey=tv%2F1&season=1&afterEpisode=-1',
])('拒绝无效查询 %s', async (query) => {
  expect((await GET(request(query))).status).toBe(400);
  expect(db.getTmdbWatchProgressByMediaKey).not.toHaveBeenCalled();
  expect(db.getTmdbWatchProgressBySource).not.toHaveBeenCalled();
});

it('未登录不能读取任何记录', async () => {
  const response = require('next/server').NextResponse.json(
    {},
    { status: 401 },
  );
  jest.mocked(requireActiveUser).mockResolvedValue({ response });
  jest.mocked(isGuardFailure).mockReturnValue(true);
  expect(await GET(request('source=src&id=id'))).toBe(response);
  expect(db.getTmdbWatchProgressBySource).not.toHaveBeenCalled();
});
