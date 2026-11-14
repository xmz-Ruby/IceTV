/** @jest-environment node */

import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import { getDetailFromApi, searchFirstPageFromApi } from '@/lib/downstream';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: { headers: {}, path: '?ac=videolist&wd=' },
    detail: { headers: {}, path: '?ac=videolist&ids=' },
  },
  getConfigForRead: jest.fn().mockResolvedValue({ SiteConfig: {} }),
}));
jest.mock('@/lib/source-health.server', () => ({
  recordSourceSearchOutcome: jest.fn(),
}));
jest.mock('@/lib/search-cache', () => ({
  getCachedSearchPage: jest.fn().mockReturnValue(null),
  peekCachedSearchPage: jest.fn().mockReturnValue(null),
  setCachedSearchPage: jest.fn(),
  dedupeSearchLoad: (
    _source: string,
    _query: string,
    _page: number,
    loader: () => Promise<unknown>,
  ) => loader(),
  loadSpecialSourceSearch: jest.fn(),
}));
jest.mock('@/lib/upstream-fetch.server', () => ({
  fetchUpstream: jest.fn(),
  fetchPrivateUpstream: jest.fn(),
}));

installStreamPolyfills();

const site = { key: 'cms', name: 'CMS', api: 'https://cms.example/vod' };
const low = ['https://media.example/720/1.m3u8'];
const high = [
  'https://media.example/2160/1.m3u8?token=test',
  'https://media.example/2160/2.mp4',
];
const item = {
  vod_id: '42',
  vod_name: '测试作品',
  vod_pic: '',
  vod_year: '2026',
  vod_content: '',
  vod_play_from: '流畅$$$蓝光4K',
  vod_play_url: `第1集$${low[0]}$$$第1集$${high[0]}#第2集$${high[1]}`,
};

function respond(overrides: Partial<typeof item> = {}) {
  (fetchUpstream as jest.Mock).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ list: [{ ...item, ...overrides }], pagecount: 1 }),
      ),
  );
}

it.each(['detail', 'search'])(
  '%s 保留各线路和真实分集，默认仍选剧集最完整的线路',
  async (entry) => {
    respond();
    const result =
      entry === 'detail'
        ? await getDetailFromApi(site, '42')
        : (await searchFirstPageFromApi(site, '测试作品'))[0];

    expect(result.episodes).toEqual(high);
    expect(result.playback_line).toBe('蓝光4K:1');
    expect(result.playback_lines).toEqual([
      {
        key: '流畅:1',
        label: '流畅',
        episodes: low,
        episodes_titles: ['第1集'],
      },
      {
        key: '蓝光4K:1',
        label: '蓝光4K',
        episodes: high,
        episodes_titles: ['第1集', '第2集'],
      },
    ]);
  },
);

it('集数相同保留首条为默认线路，并允许同名线路分别选择', async () => {
  respond({
    vod_play_from: '直连$$$直连',
    vod_play_url: `正片$${low[0]}$$$正片$${high[0]}`,
  });
  const result = await getDetailFromApi(site, '42');
  expect(result.episodes).toEqual(low);
  expect(result.playback_line).toBe('直连:1');
  expect(result.playback_lines?.map((line) => line.key)).toEqual([
    '直连:1',
    '直连:2',
  ]);
});

it('跳过不可播放线路时仍按原位置匹配名称，缺失名称提供默认标签', async () => {
  respond({
    vod_play_from: '网页$$$蓝光',
    vod_play_url: `正片$https://media.example/play.html$$$正片$${high[0]}$$$正片$${low[0]}`,
  });
  const result = await getDetailFromApi(site, '42');
  expect(result.playback_lines?.map((line) => line.label)).toEqual([
    '蓝光',
    '线路 3',
  ]);
});

it('单条可播线路保持原来的数据形状和作品集数', async () => {
  respond({
    vod_play_from: '蓝光',
    vod_play_url: `正片$${high[0]}`,
    vod_name: '电影',
  });
  const result = await getDetailFromApi(site, '42');
  expect(result.episodes).toEqual([high[0]]);
  expect(result.playback_lines).toBeUndefined();
  expect(result.playback_line).toBeUndefined();
});
