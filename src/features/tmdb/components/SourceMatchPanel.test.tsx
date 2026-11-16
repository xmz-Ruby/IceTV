import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SourceMatchPanel } from './SourceMatchPanel';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/components/modals/ModalShell', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
it('全部缺集时保留目标坐标，并提供重新校验及关闭', async () => {
  const close = jest.fn();
  const originalFetch = global.fetch;
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
  try {
    render(
      <SourceMatchPanel
        isOpen
        searchTitle='测试剧'
        displayTitle='测试剧'
        year='2024'
        searchType='tv'
        mediaKey='tv/1'
        target={{
          season: 2,
          episode: 3,
          airDate: '',
          episodeName: '',
          seasonEpisodeCount: 10,
          priorEpisodes: 10,
          strippedTitle: '测试剧',
          showYear: '2024',
        }}
        onClose={close}
      />,
    );
    expect(screen.getByText(/第2季 第3集/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新校验' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: '重新校验' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '关闭片源匹配' }));
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    global.fetch = originalFetch;
  }
});
