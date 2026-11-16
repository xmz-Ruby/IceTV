'use client';

import { useMemo } from 'react';

import {
  CapsuleSelector,
  useCapsuleIndicator,
  useSyncIndicator,
} from '@/components/CapsuleSelector';
import SkeletonText from '@/components/SkeletonText';
import {
  EPISODE_GRID_CLASS,
  EPISODE_STILL_ASPECT_CLASS,
  formatEpisodeAirDate,
  isEpisodeAired,
} from '@/features/tmdb/components/subject-layout';
import { tmdbImageUrl } from '@/features/tmdb/lib/tmdb-image-url';
import type {
  TmdbEpisode,
  TmdbSeasonSummary,
} from '@/features/tmdb/types';

interface SeasonEpisodeSectionProps {
  seasons: TmdbSeasonSummary[];
  selectedSeason: number;
  onSeasonChange: (season: number) => void;
  episodes: TmdbEpisode[] | null;
  loading: boolean;
  onEpisodeClick: (episode: TmdbEpisode) => void;
}

function seasonLabel(season: TmdbSeasonSummary): string {
  const name = (season.name || '').trim();
  if (!name) return `第 ${season.season_number} 季`;
  // TMDB 中文季名常为「第 1 季」，原名更长时保留原名（主题季名有信息量）
  return name.length <= 8 ? name : `第${season.season_number}季 ${name.slice(0, 6)}`;
}

export function SeasonEpisodeSection({
  seasons,
  selectedSeason,
  onSeasonChange,
  episodes,
  loading,
  onEpisodeClick,
}: SeasonEpisodeSectionProps) {
  const { containerRef, buttonRefs, indicatorStyle, updatePosition } =
    useCapsuleIndicator();

  const options = useMemo(
    () =>
      seasons.map((season) => ({
        label: seasonLabel(season),
        value: String(season.season_number),
      })),
    [seasons],
  );

  useSyncIndicator(options, String(selectedSeason), '1', updatePosition);

  return (
    <section aria-label='剧集分集' className='mt-10'>
      <div className='mb-4 flex items-center justify-between gap-3'>
        <h2 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
          剧集
        </h2>
        {options.length > 0 && (
          <CapsuleSelector
            options={options}
            activeValue={String(selectedSeason)}
            onChange={(value) => onSeasonChange(Number.parseInt(value, 10))}
            containerRef={containerRef}
            buttonRefs={buttonRefs}
            indicatorStyle={indicatorStyle}
          />
        )}
      </div>

      {loading && (
        <div className={EPISODE_GRID_CLASS}>
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index} className='space-y-2'>
              <div
                className={`skeleton w-full rounded-lg ${EPISODE_STILL_ASPECT_CLASS}`}
              />
              <SkeletonText
                className='text-[13px]'
                barClassName='h-4 w-3/4 rounded'
              />
            </div>
          ))}
        </div>
      )}

      {!loading && episodes && episodes.length > 0 && (
        <div className={EPISODE_GRID_CLASS}>
          {episodes.map((episode) => {
            const aired = isEpisodeAired(episode.air_date);
            return (
              <button
                key={episode.id}
                type='button'
                onClick={() => onEpisodeClick(episode)}
                className='group text-left'
              >
                <div
                  className={`relative w-full overflow-hidden rounded-lg bg-gray-100 dark:bg-white/[0.06] ${EPISODE_STILL_ASPECT_CLASS}`}
                >
                  {episode.still_path ? (
                    <img
                      src={tmdbImageUrl(episode.still_path, 'w300')}
                      alt={`第${episode.episode_number}集剧照`}
                      loading='lazy'
                      className='h-full w-full object-cover transition-opacity duration-300 group-hover:opacity-90'
                    />
                  ) : null}
                  <span className='absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white'>
                    E{episode.episode_number}
                  </span>
                  {!aired && (
                    <span className='absolute right-1.5 top-1.5 rounded bg-gray-900/80 px-1.5 py-0.5 text-xs text-gray-200'>
                      未播
                    </span>
                  )}
                </div>
                <p className='mt-1.5 truncate text-[13px] font-medium text-gray-900 dark:text-gray-100'>
                  {episode.name || `第${episode.episode_number}集`}
                </p>
                <p className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
                  {formatEpisodeAirDate(episode.air_date)}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {!loading && episodes && episodes.length === 0 && (
        <p className='py-8 text-sm text-gray-500 dark:text-gray-400'>
          本季暂无剧集信息
        </p>
      )}
    </section>
  );
}
