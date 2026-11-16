import type { TmdbWatchProgress } from '@/lib/types';

export function tmdbWatchProgressUpsert(
  dialect: 'sqlite' | 'mysql',
  username: string,
  progress: TmdbWatchProgress,
) {
  const fields = [
    'source',
    'video_id',
    'source_episode_index',
    'position',
    'duration',
  ];
  const update =
    dialect === 'sqlite'
      ? `ON CONFLICT(username, media_key, season, episode) DO UPDATE SET
      ${fields.map((field) => `${field} = excluded.${field}`).join(', ')},
      updated_at = excluded.updated_at
      WHERE excluded.updated_at >= tmdb_watch_progress.updated_at`
      : `ON DUPLICATE KEY UPDATE
      ${fields.map((field) => `${field} = IF(VALUES(updated_at) >= updated_at, VALUES(${field}), ${field})`).join(', ')},
      updated_at = GREATEST(updated_at, VALUES(updated_at))`;
  return {
    sql: `INSERT INTO tmdb_watch_progress (
      username, media_key, season, episode, source, video_id,
      source_episode_index, position, duration, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ${update}`,
    params: [
      username,
      progress.media_key,
      progress.season,
      progress.episode,
      progress.source,
      progress.video_id,
      progress.source_episode_index,
      progress.position,
      progress.duration,
      progress.updated_at,
    ],
  };
}
