/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import {
  resolveTmdbRuntimeSettings,
  searchTmdb,
  TmdbRequestError,
} from '@/features/tmdb/lib/tmdb.server';
import { requireActiveUser } from '@/lib/api-auth';

installWebPolyfills();

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((result) => Boolean(result?.response)),
  requireActiveUser: jest.fn(),
}));

jest.mock('@/lib/server-proxy-guard', () => ({
  requireServerProxyQuota: jest.fn().mockResolvedValue(null),
  recordServerProxyFailure: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getConfigForRead: jest.fn().mockResolvedValue({
    TmdbConfig: {
      Enabled: true,
      ApiHost: 'https://api.themoviedb.org/3',
      ApiKey: 'test-key',
      ImageHost: 'https://image.tmdb.org/t/p',
    },
  }),
}));

// resolve 纯逻辑不 mock（打分/剥季标记走真实实现），只 mock 回源与缓存层
jest.mock('@/features/tmdb/lib/tmdb.server', () => ({
  TmdbRequestError: class TmdbRequestError extends Error {
    constructor(
      public readonly code: string,
      public readonly status = 0,
    ) {
      super(`tmdb: ${code}`);
    }
  },
  resolveTmdbRuntimeSettings: jest.fn(),
  searchTmdb: jest.fn(),
  fetchTmdbShowDetail: jest.fn(),
  fetchTmdbSeasonDetail: jest.fn(),
  fetchTmdbMovieDetail: jest.fn(),
}));

jest.mock('@/features/tmdb/lib/tmdb-cache', () => ({
  tmdbResolveCache: {
    getOrLoad: jest.fn((_key: string, loader: () => unknown) => loader()),
  },
  tmdbShowCache: { getOrLoad: jest.fn() },
  tmdbMovieCache: { getOrLoad: jest.fn() },
  tmdbSeasonCache: { getOrLoad: jest.fn() },
}));

function createRequest(url: string) {
  return { url } as unknown as NextRequest;
}

function getHandler() {
  const { GET } = require('./route');
  return GET as (request: NextRequest) => Promise<Response>;
}

const ENABLED_SETTINGS = {
  enabled: true,
  apiBase: 'https://api.themoviedb.org/3',
  imageBase: 'https://image.tmdb.org/t/p',
  apiKey: 'test-key',
  bearerAuth: false,
};

describe('tmdb resolve route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireActiveUser as jest.Mock).mockResolvedValue({ username: 'u1' });
    (resolveTmdbRuntimeSettings as jest.Mock).mockResolvedValue(
      ENABLED_SETTINGS,
    );
  });

  it('名称精确命中返回 ok 与匹配结果', async () => {
    (searchTmdb as jest.Mock).mockResolvedValue([
      {
        id: 42,
        name: '测试剧',
        original_name: 'Test Show',
        first_air_date: '2024-05-01',
        overview: '简介',
        poster_path: '/p.jpg',
        vote_average: 8.2,
        vote_count: 300,
      },
      {
        id: 43,
        name: '另一部',
        original_name: 'Other',
        first_air_date: '2020-01-01',
        overview: '',
        poster_path: null,
        vote_average: 5,
        vote_count: 10,
      },
    ]);

    const response = await getHandler()(
      createRequest('http://localhost/api/tmdb/resolve?title=测试剧&year=2024&type=tv'),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.match.id).toBe(42);
    expect(data.match.score).toBeGreaterThanOrEqual(80);
    expect(data.strippedTitle).toBe('测试剧');
  });

  it('带季标记标题剥标记后命中全剧条目', async () => {
    (searchTmdb as jest.Mock).mockResolvedValue([
      {
        id: 7,
        name: '现在就出发',
        original_name: '',
        first_air_date: '2023-07-01',
        overview: '',
        poster_path: null,
        vote_average: 7,
        vote_count: 50,
      },
    ]);

    const response = await getHandler()(
      createRequest(
        'http://localhost/api/tmdb/resolve?title=现在就出发 第四季&year=2026&type=tv',
      ),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.strippedTitle).toBe('现在就出发');
    // 豆瓣季年份 2026 与首播 2023 差 3 年只 +2，精确名称 +80 仍过线
    expect(data.match.score).toBeGreaterThanOrEqual(60);
  });

  it('未配置 Key 返回 disabled', async () => {
    (resolveTmdbRuntimeSettings as jest.Mock).mockResolvedValue({
      ...ENABLED_SETTINGS,
      enabled: false,
    });

    const response = await getHandler()(
      createRequest('http://localhost/api/tmdb/resolve?title=测试剧&type=tv'),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('disabled');
  });

  it('无候选过线返回 no-match', async () => {
    (searchTmdb as jest.Mock).mockResolvedValue([
      {
        id: 9,
        name: '完全不相干',
        original_name: '',
        first_air_date: '1999-01-01',
        overview: '',
        poster_path: null,
        vote_average: 1,
        vote_count: 1,
      },
    ]);

    const response = await getHandler()(
      createRequest('http://localhost/api/tmdb/resolve?title=测试剧&year=2024&type=tv'),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('no-match');
  });

  it('回源抛 bad-key 映射为 502 与可定位文案', async () => {
    (searchTmdb as jest.Mock).mockImplementation(() => {
      throw new TmdbRequestError('bad-key', 401);
    });

    const response = await getHandler()(
      createRequest('http://localhost/api/tmdb/resolve?title=测试剧&type=tv'),
    );

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.status).toBe('error');
    expect(data.error).toBe('TMDB API Key 无效');
  });

  it('缺少 title 参数返回 400', async () => {
    const response = await getHandler()(
      createRequest('http://localhost/api/tmdb/resolve?type=tv'),
    );

    expect(response.status).toBe(400);
  });
});
