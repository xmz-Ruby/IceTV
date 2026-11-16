import { resolvePlaybackLineSwitch } from '@/features/play/lib/playbackLines';
import type { SearchResult } from '@/lib/types';

export interface PlaybackLineFailoverTarget {
  key: string;
  label: string;
  episodeIndex: number;
}

/**
 * 播放失败时的源内线路轮换候选：在未试过的线路里找下一个「含当前集」的线路。
 * 已试线路集合由调用方按 source:id:episodeIndex 作用域维护并跨线路切换保留，
 * 防止两条坏线路来回横跳；不含当前集的线路跳过（换过去也没法播这一集）。
 */
export function pickPlaybackLineFailoverTarget(
  detail: SearchResult,
  episodeIndex: number,
  triedLineKeys: ReadonlySet<string>,
): PlaybackLineFailoverTarget | null {
  const lines = detail.playback_lines;
  if (!lines || lines.length < 2) return null;

  for (const line of lines) {
    if (line.key === detail.playback_line) continue;
    if (triedLineKeys.has(line.key)) continue;
    const target = resolvePlaybackLineSwitch(detail, episodeIndex, line.key);
    if (target) {
      return {
        key: line.key,
        label: line.label || line.key,
        episodeIndex: target.episodeIndex,
      };
    }
  }
  return null;
}
