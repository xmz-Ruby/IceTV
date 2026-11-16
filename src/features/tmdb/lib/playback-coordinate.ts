import {
  episodeNameNumber,
  episodeNameSeason,
} from '@/features/tmdb/lib/episode-name-matcher';
import {
  inferInitialSeason,
  parseSeasonMarker,
  stripSeasonMarker,
} from '@/features/tmdb/lib/resolve';
import { matchSourceEntryForEpisode } from '@/features/tmdb/lib/source-episode-match';
import {
  fetchTmdbMovieDetail,
  fetchTmdbSeasonDetail,
  fetchTmdbShowDetail,
  resolveBestTmdbMatch,
  resolveTmdbClientSettings,
} from '@/features/tmdb/lib/tmdb-client';
import { getTmdbWatchProgressBySource } from '@/lib/db.client';
import { resolveEpisodeGroupPosition } from '@/lib/episode-groups';
import { isValidTmdbEpisodeCoordinate } from '@/lib/tmdb-watch-history';
import type { SearchResult, TmdbEpisodeCoordinate } from '@/lib/types';

/** 用同一集匹配器反查实际播放坐标，绝不把源数组下标直接当作 TMDB 集号。 */
export async function resolveTmdbPlaybackCoordinate(
  detail: SearchResult,
  episodeIndex: number,
  hint?: TmdbEpisodeCoordinate,
  signal?: AbortSignal,
): Promise<TmdbEpisodeCoordinate | null> {
  const settings = resolveTmdbClientSettings();
  if (!settings || !detail.episodes[episodeIndex] || signal?.aborted)
    return null;

  let known = isValidTmdbEpisodeCoordinate(hint) ? hint : undefined;
  if (!known) {
    // 直进播放或刷新时，从该源上次写入的坐标找回作品；仍按当前集清单重新匹配。
    const progress = await getTmdbWatchProgressBySource(
      detail.source,
      detail.id,
    ).catch(() => []);
    if (signal?.aborted) return null;
    known = progress.find(isValidTmdbEpisodeCoordinate);
  }
  const resolved = known
    ? null
    : await resolveBestTmdbMatch(
        detail.title,
        detail.year,
        detail.episodes.length === 1 ? 'movie' : 'tv',
        signal,
      );
  const mediaKey =
    known?.media_key ??
    (resolved?.match ? `${resolved.match.mediaType}/${resolved.match.id}` : '');
  if (!mediaKey || signal?.aborted) return null;
  const [mediaType, id] = mediaKey.split('/');
  const coordinate = {
    media_key: mediaKey,
    source: detail.source,
    video_id: detail.id,
    source_episode_index: episodeIndex + 1,
  };

  if (mediaType === 'movie') {
    const movie = await fetchTmdbMovieDetail(settings, Number(id), signal);
    const result = matchSourceEntryForEpisode(detail, {
      season: 0,
      episode: 1,
      strippedTitle: movie.title,
      showYear: movie.release_date?.slice(0, 4) || '',
      airDate: '',
      episodeName: '',
      seasonEpisodeCount: 1,
      priorEpisodes: 0,
    });
    return result.episodeIndex === episodeIndex
      ? { ...coordinate, season: 0, episode: 1 }
      : null;
  }

  const show = await fetchTmdbShowDetail(settings, Number(id), signal);
  if (signal?.aborted) return null;
  const seasons = show.seasons.filter((season) => season.season_number > 0);
  const groupPosition = resolveEpisodeGroupPosition(
    detail.episode_groups,
    episodeIndex,
    detail.episodes.length,
  );
  const marker = Math.max(
    0,
    episodeNameSeason(detail.episodes_titles?.[episodeIndex] || ''),
    parseSeasonMarker(detail.title),
    groupPosition
      ? parseSeasonMarker(
          detail.episode_groups?.[groupPosition.groupIndex]?.label || '',
        )
      : 0,
  );
  let seasonNumber =
    marker ||
    known?.season ||
    inferInitialSeason(seasons, {
      markerSeason: 0,
      doubanYear: detail.year,
    });

  // 无季标的连播源沿用匹配器的绝对集号口径；按整剧季集数定位应查询的季。
  if (
    !marker &&
    seasons.length > 1 &&
    detail.episodes.length >
      Math.max(...seasons.map((season) => season.episode_count))
  ) {
    const absolute =
      episodeNameNumber(detail.episodes_titles?.[episodeIndex] || '') ||
      episodeIndex + 1;
    let prior = 0;
    for (const season of [...seasons].sort(
      (a, b) => a.season_number - b.season_number,
    )) {
      if (absolute > prior && absolute <= prior + season.episode_count) {
        seasonNumber = season.season_number;
        break;
      }
      prior += season.episode_count;
    }
  }

  const summary = seasons.find(
    (season) => season.season_number === seasonNumber,
  );
  if (!summary) return null;
  const season = await fetchTmdbSeasonDetail(
    settings,
    Number(id),
    seasonNumber,
    signal,
  );
  if (signal?.aborted) return null;
  const matches = season.episodes.filter((episode) => {
    const result = matchSourceEntryForEpisode(detail, {
      season: seasonNumber,
      episode: episode.episode_number,
      strippedTitle: stripSeasonMarker(show.name) || show.name,
      showYear: show.first_air_date?.slice(0, 4) || '',
      airDate: episode.air_date || '',
      episodeName: episode.name,
      seasonEpisodeCount: summary.episode_count || season.episodes.length,
      priorEpisodes: seasons
        .filter((item) => item.season_number < seasonNumber)
        .reduce((sum, item) => sum + item.episode_count, 0),
      seasonThemeNames: [summary.name],
    });
    return result.status === 'matched' && result.episodeIndex === episodeIndex;
  });
  return matches.length === 1
    ? {
        ...coordinate,
        season: seasonNumber,
        episode: matches[0].episode_number,
      }
    : null;
}
