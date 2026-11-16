import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TmdbSearchResults } from '@/features/search/components/TmdbSearchResults';
import type { TmdbMultiSearchItem } from '@/features/tmdb/lib/tmdb-client';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const searchMultiSmartMock = jest.fn();
const resolveSettingsMock = jest.fn();

jest.mock('@/features/tmdb/lib/tmdb-client', () => ({
  ...jest.requireActual('@/features/tmdb/lib/tmdb-client'),
  resolveTmdbClientSettings: (...args: unknown[]) =>
    resolveSettingsMock(...args),
  searchTmdbMultiSmart: (...args: unknown[]) => searchMultiSmartMock(...args),
}));

const RUNTIME_SETTINGS = {
  apiBase: 'https://api.themoviedb.org/3',
  imageBase: 'https://image.tmdb.org/t/p',
  apiKey: 'key',
  bearerAuth: false,
};

function makeItem(
  overrides: Partial<TmdbMultiSearchItem>,
): TmdbMultiSearchItem {
  return {
    id: 95776,
    mediaType: 'tv',
    name: '庆余年',
    original_name: '庆余年',
    first_air_date: '2019-11-26',
    overview: '少年范闲的传奇故事',
    poster_path: '/poster.jpg',
    vote_average: 8.4,
    vote_count: 100,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resolveSettingsMock.mockReturnValue(RUNTIME_SETTINGS);
});

it('渲染 multi 结果行，点击进 /subject 并携带 tmdbId/stype/季提示', async () => {
  searchMultiSmartMock.mockResolvedValue({
    items: [makeItem({})],
    strippedQuery: '',
  });
  render(
    <TmdbSearchResults query='庆余年 第二季' onFallbackToSource={jest.fn()} />,
  );

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /庆余年/ })).toBeInTheDocument(),
  );
  expect(screen.getByText(/2019 · 剧集 · ★ 8\.4/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /庆余年/ }));
  expect(pushMock).toHaveBeenCalledWith(
    '/subject?title=%E5%BA%86%E4%BD%99%E5%B9%B4&year=2019&stype=tv&tmdbId=95776&season=2',
  );
});

it('空结果时触发自动切源回调并带提示文案', async () => {
  searchMultiSmartMock.mockResolvedValue({ items: [], strippedQuery: '' });
  const onFallbackToSource = jest.fn();
  render(
    <TmdbSearchResults
      query='不存在的'
      onFallbackToSource={onFallbackToSource}
    />,
  );

  await waitFor(() => expect(onFallbackToSource).toHaveBeenCalledTimes(1));
  expect(onFallbackToSource).toHaveBeenCalledWith(
    'TMDB 未找到相关内容，已切换到片源搜索',
  );
});

it('请求失败时同样切源，文案含可指路的错误说明', async () => {
  searchMultiSmartMock.mockRejectedValue(new Error('network down'));
  const onFallbackToSource = jest.fn();
  render(
    <TmdbSearchResults query='测试' onFallbackToSource={onFallbackToSource} />,
  );

  await waitFor(() => expect(onFallbackToSource).toHaveBeenCalledTimes(1));
  const notice = onFallbackToSource.mock.calls[0][0] as string;
  expect(notice).toContain('已切换到片源搜索');
});

it('手动点击「在全部片源中搜索」不带提示文案', async () => {
  searchMultiSmartMock.mockResolvedValue({
    items: [makeItem({})],
    strippedQuery: '',
  });
  const onFallbackToSource = jest.fn();
  render(
    <TmdbSearchResults
      query='庆余年'
      onFallbackToSource={onFallbackToSource}
    />,
  );

  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '在全部片源中搜索' }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: '在全部片源中搜索' }));
  expect(onFallbackToSource).toHaveBeenCalledWith();
});
