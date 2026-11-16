import type { TmdbEpisodeCoordinate } from '@/lib/types';

const TMDB_MEDIA_KEY_RE = /^(?:tv|movie)\/[1-9]\d{0,15}$/;

export function isValidTmdbEpisodeCoordinate(
  value: unknown,
): value is TmdbEpisodeCoordinate {
  if (!value || typeof value !== 'object') return false;
  const coordinate = value as Partial<TmdbEpisodeCoordinate>;
  if (
    typeof coordinate.media_key !== 'string' ||
    !isValidTmdbMediaKey(coordinate.media_key) ||
    !Number.isSafeInteger(coordinate.season) ||
    coordinate.season! < 0 ||
    coordinate.season! > 999 ||
    !Number.isSafeInteger(coordinate.episode) ||
    coordinate.episode! < 1 ||
    coordinate.episode! > 100_000 ||
    typeof coordinate.source !== 'string' ||
    !coordinate.source.trim() ||
    coordinate.source.length > 191 ||
    typeof coordinate.video_id !== 'string' ||
    !coordinate.video_id.trim() ||
    coordinate.video_id.length > 255 ||
    !Number.isSafeInteger(coordinate.source_episode_index) ||
    coordinate.source_episode_index! < 1 ||
    coordinate.source_episode_index! > 100_000
  ) {
    return false;
  }

  return (
    !coordinate.media_key.startsWith('movie/') ||
    (coordinate.season === 0 && coordinate.episode === 1)
  );
}

export function isValidTmdbMediaKey(value: string): boolean {
  return (
    TMDB_MEDIA_KEY_RE.test(value) &&
    Number.isSafeInteger(Number(value.split('/')[1]))
  );
}

export const TMDB_WATCH_PROGRESS_PAGE_SIZE = 100;
