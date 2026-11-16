import { writeTmdbSettings } from '@/lib/tmdb-preferences';

import {
  buildTmdbRequestUrl,
  describeTmdbClientError,
  fetchTmdbShowDetail,
  resolveBestTmdbMatch,
  resolveTmdbClientSettings,
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
    expect(url).toBe(
      'https://api.themoviedb.org/3/tv/123?language=zh-CN',
    );
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
    expect(
      describeTmdbClientError(new TmdbRequestError('network')),
    ).toContain('需支持跨域');
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
  });

  it('没填 Key 时直接报 bad-key，不发请求', async () => {
    await expect(
      testTmdbConnection({ enabled: true, apiHost: '', apiKey: '' }),
    ).rejects.toMatchObject({ code: 'bad-key' });
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
    expect(first.seasons[0]).toMatchObject({ season_number: 1, episode_count: 9 });
    expect(first.seasons[1]).toMatchObject({ season_number: 0, episode_count: 0 });

    await fetchTmdbShowDetail(settings, 94605);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('401/403 映射 bad-key', async () => {
    mockFetch({ status_message: 'Invalid API key' }, { ok: false, status: 401 });
    writeTmdbSettings({ enabled: true, apiKey: 'bad' });
    const settings = resolveTmdbClientSettings()!;
    await expect(fetchTmdbShowDetail(settings, 1)).rejects.toMatchObject({
      code: 'bad-key',
      status: 401,
    });
  });
});
