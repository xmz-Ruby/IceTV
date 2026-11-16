import type { MutableRefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type { useEpisodeSwitch } from '@/features/play/hooks/useEpisodeSwitch';
import type { useSourceSwitch } from '@/features/play/hooks/useSourceSwitch';
import {
  type TmdbPlaybackTarget,
  buildTmdbVerificationUrl,
  findTmdbEpisodeSource,
  loadNextTmdbEpisode,
} from '@/features/tmdb/lib/next-episode';
import { resolveTmdbPlaybackCoordinate } from '@/features/tmdb/lib/playback-coordinate';
import { withAbortableTimeout } from '@/lib/concurrency';
import { PLAYER_EXIT_EVENT } from '@/lib/navigation-return';
import {
  buildSubjectPageUrl,
  isTmdbSubjectEntryEnabled,
} from '@/lib/subject-navigation';
import { dismissToast, showToast } from '@/lib/toast';
import type { SearchResult, TmdbEpisodeCoordinate } from '@/lib/types';

interface Options {
  detail: SearchResult | null;
  episodeIndex: number;
  detailRef: MutableRefObject<SearchResult | null>;
  episodeIndexRef: MutableRefObject<number>;
  coordinateRef: MutableRefObject<TmdbEpisodeCoordinate | null>;
  availableSources: SearchResult[];
  saveProgress: () => void | Promise<unknown>;
  resetPlaybackIntent: () => void;
  switchEpisode: ReturnType<typeof useEpisodeSwitch>['switchEpisode'];
  changeSource: ReturnType<typeof useSourceSwitch>['handleSourceChange'];
  navigate: (url: string) => void;
}

export function useTmdbNextEpisode(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const request = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    request.current?.abort();
    request.current = null;
    dismissToast('tmdb-next-loading');
  }, []);
  useEffect(
    () => cancel,
    [options.detail?.source, options.detail?.id, options.episodeIndex, cancel],
  );
  useEffect(() => {
    window.addEventListener(PLAYER_EXIT_EVENT, cancel);
    return () => window.removeEventListener(PLAYER_EXIT_EVENT, cancel);
  }, [cancel]);

  const advance = useCallback((): boolean => {
    const state = latest.current;
    const detail = state.detailRef.current;
    if (!detail || !isTmdbSubjectEntryEnabled()) return false;
    if (request.current) return true;
    state.resetPlaybackIntent();
    const controller = new AbortController();
    request.current = controller;
    showToast('正在查找下一集…', 'info', { key: 'tmdb-next-loading' });
    const index = state.episodeIndexRef.current;
    const valid = () =>
      request.current === controller &&
      !controller.signal.aborted &&
      latest.current.detailRef.current === detail &&
      latest.current.episodeIndexRef.current === index;
    let target: TmdbPlaybackTarget | null = null;
    void withAbortableTimeout(
      async (signal) => {
        const known = state.coordinateRef.current;
        const coordinate =
          known?.source === detail.source &&
          known.video_id === detail.id &&
          known.source_episode_index === index + 1
            ? known
            : await resolveTmdbPlaybackCoordinate(
                detail,
                index,
                undefined,
                signal,
              );
        if (!valid()) return;
        if (!coordinate) {
          showToast('无法确认下一集坐标，请在详情页选择剧集', 'notice');
          state.navigate(
            buildSubjectPageUrl({
              title: detail.title,
              year: detail.year,
              type: detail.episodes.length > 1 ? 'tv' : 'movie',
            }),
          );
          return;
        }
        target = await loadNextTmdbEpisode(coordinate, signal);
        if (!valid()) return;
        if (!target) {
          showToast('暂无已播出的下一集', 'info');
          return;
        }
        await state.saveProgress();
        const match = await findTmdbEpisodeSource(
          target,
          detail,
          state.availableSources,
          signal,
        );
        if (!valid()) return;
        if (!match) {
          showToast('当前片源缺少下一集，请重新校验片源', 'notice');
          state.navigate(buildTmdbVerificationUrl(target));
          return;
        }
        if (
          match.detail.source === detail.source &&
          match.detail.id === detail.id
        ) {
          state.switchEpisode(match.episodeIndex, match.detail, {
            fromStart: true,
          });
          state.coordinateRef.current = {
            media_key: target.mediaKey,
            season: target.target.season,
            episode: target.target.episode,
            source: match.detail.source,
            video_id: match.detail.id,
            source_episode_index: match.episodeIndex + 1,
          };
        } else {
          await state.changeSource(
            match.detail.source,
            match.detail.id,
            match.detail.title,
            { nextEpisode: target, detail: match.detail },
          );
        }
      },
      30_000,
      '下一集定位超时',
      controller.signal,
    )
      .catch((error: unknown) => {
        if (!valid()) return;
        console.warn('下一集定位失败:', error);
        showToast('下一集暂时无法播放，请重新校验片源', 'notice');
        state.navigate(
          target
            ? buildTmdbVerificationUrl(target)
            : buildSubjectPageUrl({
                title: detail.title,
                year: detail.year,
                type: 'tv',
              }),
        );
      })
      .finally(() => {
        if (request.current === controller) {
          dismissToast('tmdb-next-loading');
          request.current = null;
        }
      });
    return true;
  }, []);
  return { advance, cancel };
}
