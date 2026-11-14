import { extractEpisodeNumberFromTitle } from '@/features/play/lib/episodeMapping';
import type { SearchResult } from '@/lib/types';

export function selectPlaybackLine(
  detail: SearchResult,
  key: string | undefined,
): SearchResult {
  const line = detail.playback_lines?.find((entry) => entry.key === key);
  if (!line || detail.playback_line === key) return detail;
  return {
    ...detail,
    episodes: line.episodes,
    episodes_titles: line.episodes_titles,
    playback_line: line.key,
  };
}

export function retainPlaybackLine(
  previous: SearchResult,
  fresh: SearchResult,
): SearchResult {
  return previous.source === fresh.source && previous.id === fresh.id
    ? selectPlaybackLine(fresh, previous.playback_line)
    : fresh;
}

export function resolvePlaybackLineSwitch(
  detail: SearchResult,
  episodeIndex: number,
  key: string,
): { detail: SearchResult; episodeIndex: number } | null {
  const next = selectPlaybackLine(detail, key);
  if (next === detail) return null;

  const title = detail.episodes_titles[episodeIndex] || '';
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().toLowerCase();
  let targetIndex = title
    ? next.episodes_titles.findIndex(
        (entry) => normalize(entry) === normalize(title),
      )
    : -1;
  if (targetIndex < 0) {
    const number = extractEpisodeNumberFromTitle(title);
    if (number !== null) {
      targetIndex = next.episodes_titles.findIndex(
        (entry) => extractEpisodeNumberFromTitle(entry) === number,
      );
    } else if (detail.episodes.length === 1 && next.episodes.length === 1) {
      targetIndex = 0;
    } else if (!title && detail.episodes.length === next.episodes.length) {
      targetIndex = episodeIndex;
    }
    if (
      targetIndex < 0 &&
      detail.episodes.length === 1 &&
      next.episodes.length === 1 &&
      /(?:\d{3,4}p|[248]k)/i.test(title)
    ) {
      targetIndex = 0;
    }
  }
  return targetIndex >= 0 && targetIndex < next.episodes.length
    ? { detail: next, episodeIndex: targetIndex }
    : null;
}
