import { fireEvent, render, screen } from '@testing-library/react';

import type { TmdbEpisode } from '@/features/tmdb/types';
import type { TmdbWatchProgress } from '@/lib/types';

import { SeasonEpisodeSection } from './SeasonEpisodeSection';

const episodes = [1, 2, 3].map(
  (n) =>
    ({
      id: n,
      episode_number: n,
      season_number: 2,
      name: `Episode ${n}`,
      air_date: '2024-01-01',
      still_path: null,
    }) as TmdbEpisode,
);
const base: TmdbWatchProgress = {
  media_key: 'tv/1',
  season: 2,
  episode: 1,
  source: 'a',
  video_id: 'id',
  source_episode_index: 1,
  position: 90,
  duration: 100,
  updated_at: 1,
};
it('逐集显示已看和部分进度，其他季与零进度不显示角标', () => {
  const click = jest.fn();
  render(
    <SeasonEpisodeSection
      seasons={[]}
      selectedSeason={2}
      onSeasonChange={jest.fn()}
      episodes={episodes}
      loading={false}
      onEpisodeClick={click}
      progress={[
        base,
        { ...base, episode: 2, position: 45 },
        { ...base, season: 1, episode: 3 },
      ]}
    />,
  );
  expect(screen.getByRole('button', { name: /Episode 1/ })).toHaveTextContent(
    '已看',
  );
  expect(screen.getByRole('button', { name: /Episode 2/ })).toHaveTextContent(
    '看到 45%',
  );
  expect(
    screen.getByRole('button', { name: /Episode 3/ }),
  ).not.toHaveTextContent(/已看|看到/);
  fireEvent.click(screen.getByRole('button', { name: /Episode 2/ }));
  expect(click).toHaveBeenCalledWith(episodes[1]);
});
it('进度读取失败提供重试，选集保持可用', () => {
  const retry = jest.fn();
  render(
    <SeasonEpisodeSection
      seasons={[]}
      selectedSeason={2}
      onSeasonChange={jest.fn()}
      episodes={episodes}
      loading={false}
      onEpisodeClick={jest.fn()}
      progressError
      onRetryProgress={retry}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('观看进度暂时不可用');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: /Episode 1/ })).toBeEnabled();
});
