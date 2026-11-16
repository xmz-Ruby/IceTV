import { writeTmdbSettings } from '@/lib/tmdb-preferences';

import {
  buildTmdbRequestUrl,
  describeTmdbClientError,
  fetchTmdbShowDetail,
  resolveBestTmdbMatch,
  resolveTmdbClientSettings,
  searchTmdbMulti,
  searchTmdbMultiSmart,
  testTmdbConnection,
  TmdbRequestError,
} from '../tmdb-client';

const V3_SETTINGS = {
  apiBase: 'https://api.themoviedb.org/3',
  imageBase: 'https://image.tmdb.org/t/p',
  apiKey: 'v3-key',
  bearerAuth: false,
} as const;

const V4_SETTINGS = {
  ...V3_SETTINGS,
  apiKey: 'eyJhbGciOiJIVCJ9.token',
  bearerAuth: true,
} as const;

describe('buildTmdbRequestUrl', () => {
  it('v3 Key 附在 query，language 固定 zh-CN，参数合并且跳过空值', () => {
    const url = buildTmdbRequestUrl(V3_SETTINGS, '/search/tv', {
      query: '庆余年',
      page: '1',
      include_adult: '',
    });
    expect(url).toBe(
      'https://api.themoviedb.org/3/search/tv?language=zh-CN&query=' +
        encodeURIComponent('庆余年') +
        '&page=1&api_key=v3-key',
    );
  });

  it('v4 token（eyJ 开头）不往 query 附 api_key，鉴权交给 Authorization 头', () => {
    const url = buildTmdbRequestUrl(V4_SETTINGS, '/tv/123');
    expect(url).toBe('https://api.themoviedb.org/3/tv/123?language=zh-CN');
    expect(url).not.toContain('api_key');
  });
});

describe('resolveTmdbClientSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未启用（开关关/没填 Key）返回 null', () => {
    expect(resolveTmdbClientSettings()).toBeNull();
    writeTmdbSettings({ enabled: true, apiKey: '' });
    expect(resolveTmdbClientSettings()).toBeNull();
    writeTmdbSettings({ enabled: false, apiKey: 'abc' });
    expect(resolveTmdbClientSettings()).toBeNull();
  });

  it('启用后按 Key 形态选择鉴权方式', () => {
    writeTmdbSettings({ enabled: true, apiKey: 'v3-key' });
    expect(resolveTmdbClientSettings()).toEqual({
      apiBase: 'https://api.themoviedb.org/3',
      imageBase: 'https://image.tmdb.org/t/p',
      apiKey: 'v3-key',
      bearerAuth: false,
    });
    writeTmdbSettings({ enabled: true, apiKey: 'eyJtoken' });
    expect(resolveTmdbClientSettings()?.bearerAuth).toBe(true);
  });
});

describe('resolveBestTmdbMatch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未启用直接返回 disabled，不发任何请求', async () => {
    await expect(resolveBestTmdbMatch('庆余年', '2024', 'tv')).resolves.toEqual(
      { status: 'disabled', match: null, strippedTitle: '' },
    );
  });
});

describe('describeTmdbClientError', () => {
  it('映射各错误码为可指路文案，未知错误回落默认', () => {
    expect(describeTmdbClientError(new TmdbRequestError('bad-key'))).toBe(
      'TMDB API Key 无效',
    );
    expect(describeTmdbClientError(new TmdbRequestError('timeout'))).toBe(
      'TMDB 请求超时',
    );
    expect(describeTmdbClientError(new TmdbRequestError('network'))).toContain(
      '需支持跨域',
    );
    expect(describeTmdbClientError(new TmdbRequestError('bad-response'))).toBe(
      'TMDB 返回了无法解析的内容',
    );
    expect(describeTmdbClientError(new Error('boom'))).toBe('TMDB 请求失败');
    expect(describeTmdbClientError(null, '兜底')).toBe('兜底');
  });
});

describe('testTmdbConnection', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.RUNTIME_CONFIG;
  });

  afterEach(() => {
    delete window.RUNTIME_CONFIG;
  });

  it('没填 Key（也没有站点默认 Key）时直接报 bad-key，不发请求', async () => {
    await expect(
      testTmdbConnection({ apiHost: '', apiKey: '' }),
    ).rejects.toMatchObject({ code: 'bad-key' });
  });

  it('草稿留空时用站点默认 host + Key 打 /configuration', async () => {
    window.RUNTIME_CONFIG = {
      TMDB_DEFAULT_ENABLED: true,
      TMDB_DEFAULT_API_HOST: 'https://mirror.example.com/3',
      TMDB_DEFAULT_API_KEY: 'eyJsite-token',
      TMDB_DEFAULT_IMAGE_HOST: 'https://image.tmdb.org/t/p',
    } as never;
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    try {
      await testTmdbConnection({ apiHost: '', apiKey: '' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://mirror.example.com/3/configuration?language=zh-CN',
      );
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer eyJsite-token',
      );
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  });
});

describe('searchTmdbMulti (mock fetch)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    delete window.RUNTIME_CONFIG;
  });

  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
  });

  function mockFetch(body: unknown) {
    const fn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    } as unknown as Response);
    (globalThis as { fetch?: unknown }).fetch = fn;
    return fn;
  }

  it('multi 搜索只保留 tv/movie，person 结果被过滤', async () => {
    const fetchMock = mockFetch({
      results: [
        {
          id: 1,
          media_type: 'tv',
          name: '庆余年',
          first_air_date: '2019-11-26',
          vote_average: 8,
        },
        { id: 2, media_type: 'person', name: '张若昀' },
        {
          id: 3,
          media_type: 'movie',
          title: '庆余年番外',
          release_date: '2020-01-01',
        },
        { id: 0, media_type: 'tv', name: '' },
      ],
    });
    const items = await searchTmdbMulti(V3_SETTINGS, '庆余年');
    expect(items.map((item) => `${item.mediaType}:${item.name}`)).toEqual([
      'tv:庆余年',
      'movie:庆余年番外',
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.themoviedb.org/3/search/multi?language=zh-CN&query=' +
        encodeURIComponent('庆余年') +
        '&include_adult=false&page=1&api_key=v3-key',
    );
  });

  it('原词空结果时剥季标记重搜一轮（「XX 第二季」→「XX」）', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ results: [] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ id: 9, media_type: 'tv', name: '凡人修仙传' }],
        }),
      } as unknown as Response);
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { items, strippedQuery } = await searchTmdbMultiSmart(
      V3_SETTINGS,
      '凡人修仙传 第二季',
    );
    expect(strippedQuery).toBe('凡人修仙传');
    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain('query=' + encodeURIComponent('凡人修仙传'));
  });

  it('两轮都空时不再追加请求，strippedQuery 为空', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    } as unknown as Response);
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { items, strippedQuery } = await searchTmdbMultiSmart(
      V3_SETTINGS,
      '不存在的剧 第二季',
    );
    expect(items).toHaveLength(0);
    expect(strippedQuery).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('fetchTmdbShowDetail (mock fetch)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    (globalThis as { fetch?: unknown }).fetch = originalFetch;
  });

  function mockFetch(body: unknown, init: { ok: boolean; status: number }) {
    // jsdom 不带 fetch，直接赋值 mock，afterEach 里还原
    const fn = jest.fn().mockResolvedValue({
      ok: init.ok,
      status: init.status,
      body: null,
      json: async () => body,
    } as unknown as Response);
    (globalThis as { fetch?: unknown }).fetch = fn;
    return fn;
  }

  it('解析 tv 详情并做会话缓存（第二次不再请求）', async () => {
    const fetchMock = mockFetch(
      {
        id: 94605,
        name: 'Arcane',
        original_name: 'Arcane',
        overview: '…',
        first_air_date: '2021-11-06',
        poster_path: '/poster.jpg',
        genres: [{ id: 16, name: 'Animation' }, { name: '' }],
        seasons: [
          { id: 1, season_number: 1, episode_count: 9 },
          { id: 2, season_number: 0 },
        ],
      },
      { ok: true, status: 200 },
    );
    writeTmdbSettings({ enabled: true, apiKey: 'v3-key' });
    const settings = resolveTmdbClientSettings()!;

    const first = await fetchTmdbShowDetail(settings, 94605);
    expect(first.name).toBe('Arcane');
    expect(first.genres).toEqual(['Animation']);
    // 解析层保留季 0（隐藏特殊季由页面 visibleSeasons 负责）
    expect(first.seasons).toHaveLength(2);
    expect(first.seasons[0]).toMatchObject({
      season_number: 1,
      episode_count: 9,
    });
    expect(first.seasons[1]).toMatchObject({
      season_number: 0,
      episode_count: 0,
    });

    await fetchTmdbShowDetail(settings, 94605);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401/403 映射 bad-key', async () => {
    mockFetch(
      { status_message: 'Invalid API key' },
      { ok: false, status: 401 },
    );
    writeTmdbSettings({ enabled: true, apiKey: 'bad' });
    const settings = resolveTmdbClientSettings()!;
    await expect(fetchTmdbShowDetail(settings, 1)).rejects.toMatchObject({
      code: 'bad-key',
      status: 401,
    });
  });
});
