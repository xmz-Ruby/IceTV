import { selectPlaybackLine } from '@/features/play/lib/playbackLines';
import { isEpisodeAired } from '@/features/tmdb/components/subject-layout';
import { resolveTmdbPlaybackCoordinate } from '@/features/tmdb/lib/playback-coordinate';
import { stripSeasonMarker } from '@/features/tmdb/lib/resolve';
import {
  type TmdbEpisodeTarget,
  matchSourceEntryForEpisode,
} from '@/features/tmdb/lib/source-episode-match';
import {
  fetchTmdbSeasonDetail,
  fetchTmdbShowDetail,
  resolveTmdbClientSettings,
} from '@/features/tmdb/lib/tmdb-client';
import { withAbortableTimeout } from '@/lib/concurrency';
import { buildSubjectPageUrl } from '@/lib/subject-navigation';
import type { SearchResult, TmdbEpisodeCoordinate } from '@/lib/types';

export interface TmdbPlaybackTarget {
  mediaKey: string;
  title: string;
  year: string;
  target: TmdbEpisodeTarget;
}

export async function loadNextTmdbEpisode(
  coordinate: TmdbEpisodeCoordinate,
  signal?: AbortSignal,
): Promise<TmdbPlaybackTarget | null> {
  const settings = resolveTmdbClientSettings();
  if (!settings || !coordinate.media_key.startsWith('tv/')) return null;
  const id = Number(coordinate.media_key.slice(3));
  const show = await fetchTmdbShowDetail(settings, id, signal);
  const seasons = show.seasons
    .filter(
      (season) =>
        season.season_number >= coordinate.season &&
        season.season_number > 0 &&
        season.episode_count > 0,
    )
    .sort((a, b) => a.season_number - b.season_number);
  for (const summary of seasons) {
    if (signal?.aborted) return null;
    const detail = await fetchTmdbSeasonDetail(
      settings,
      id,
      summary.season_number,
      signal,
    );
    const next = [...detail.episodes]
      .sort((a, b) => a.episode_number - b.episode_number)
      .find(
        (episode) =>
          summary.season_number > coordinate.season ||
          episode.episode_number > coordinate.episode,
      );
    // 季内下一集尚未播出时不跳过它去下一季。
    if (next && !isEpisodeAired(next.air_date)) return null;
    if (next)
      return {
        mediaKey: coordinate.media_key,
        title: show.name,
        year: show.first_air_date?.slice(0, 4) || '',
        target: {
          season: summary.season_number,
          episode: next.episode_number,
          airDate: next.air_date || '',
          episodeName: next.name,
          strippedTitle: stripSeasonMarker(show.name) || show.name,
          showYear: show.first_air_date?.slice(0, 4) || '',
          seasonEpisodeCount: summary.episode_count,
          priorEpisodes: show.seasons
            .filter(
              (season) =>
                season.season_number > 0 &&
                season.season_number < summary.season_number,
            )
            .reduce((sum, season) => sum + season.episode_count, 0),
          seasonThemeNames: [summary.name],
        },
      };
  }
  return null;
}

export function matchTmdbPlaybackTarget(
  detail: SearchResult,
  target: TmdbPlaybackTarget,
) {
  for (const candidate of [
    detail,
    ...(detail.playback_lines || [])
      .filter((line) => line.key !== detail.playback_line)
      .map((line) => selectPlaybackLine(detail, line.key)),
  ]) {
    const match = matchSourceEntryForEpisode(candidate, target.target);
    if (
      match.status === 'matched' &&
      match.episodeIndex !== null &&
      candidate.episodes[match.episodeIndex]
    ) {
      return { detail: candidate, episodeIndex: match.episodeIndex };
    }
  }
  return null;
}

export async function findTmdbEpisodeSource(
  target: TmdbPlaybackTarget,
  current: SearchResult,
  available: SearchResult[],
  signal: AbortSignal,
) {
  if (signal.aborted) return null;
  const local = matchTmdbPlaybackTarget(current, target);
  if (local) return local;
  const tried = new Set([JSON.stringify([current.source, current.id])]);
  const trySources = async (sources: SearchResult[]) => {
    for (const source of sources) {
      if (signal.aborted) return null;
      const key = JSON.stringify([source.source, source.id]);
      if (tried.has(key)) continue;
      tried.add(key);
      // 搜索可能尚未返回完整集列表，拉详情后再判断，不能按源列表下标猜。
      try {
        const detail = await withAbortableTimeout(
          async (requestSignal) => {
            const params = new URLSearchParams({
              source: source.source,
              id: source.id,
            });
            const response = await fetch(`/api/detail?${params}`, {
              signal: requestSignal,
            });
            if (!response.ok) return null;
            return (await response.json()) as SearchResult;
          },
          10_000,
          '片源详情获取超时',
          signal,
        );
        if (signal.aborted) return null;
        if (detail?.source !== source.source || detail.id !== source.id)
          continue;
        const match = matchTmdbPlaybackTarget(detail, target);
        if (match) return match;
      } catch {
        if (signal.aborted) return null;
      }
    }
    return null;
  };
  const known = await trySources(available);
  if (known || signal.aborted) return known;
  const response = await fetch(
    `/api/search?q=${encodeURIComponent(target.target.strippedTitle)}`,
    { signal },
  );
  if (!response.ok) throw new Error('片源搜索失败');
  const data = (await response.json()) as { results?: SearchResult[] };
  return trySources(Array.isArray(data.results) ? data.results : []);
}

export async function resolveTmdbNextPreloadUrl(
  detail: SearchResult,
  episodeIndex: number,
  hint: TmdbEpisodeCoordinate | null,
  signal: AbortSignal,
): Promise<string | null> {
  const coordinate =
    hint?.source === detail.source &&
    hint.video_id === detail.id &&
    hint.source_episode_index === episodeIndex + 1
      ? hint
      : await resolveTmdbPlaybackCoordinate(
          detail,
          episodeIndex,
          undefined,
          signal,
        );
  if (!coordinate || signal.aborted) return null;
  const target = await loadNextTmdbEpisode(coordinate, signal);
  if (!target || signal.aborted) return null;
  const match = matchTmdbPlaybackTarget(detail, target);
  return match?.detail.episodes[match.episodeIndex] || null;
}

export function buildTmdbVerificationUrl(target: TmdbPlaybackTarget): string {
  const url = buildSubjectPageUrl({
    title: target.title,
    year: target.year,
    type: 'tv',
    tmdbId: Number(target.mediaKey.slice(3)),
    season: target.target.season,
  });
  return `${url}&episode=${target.target.episode}&verify=1`;
}
