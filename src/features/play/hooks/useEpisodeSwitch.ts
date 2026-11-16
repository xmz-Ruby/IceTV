import type Artplayer from 'artplayer';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
} from 'react';

import type {
  PlaybackRequestMode,
  VideoLoadingStage,
} from '@/features/play/hooks/usePlayPageState';
import { saveDetailSnapshot } from '@/features/play/lib/detailSnapshot';
import { shouldInheritCrossGroupProgress } from '@/features/play/lib/episodeGroups';
import type { SourceSwitchEpisodeAnchor } from '@/features/play/lib/episodeResumePolicy';
import { resolveSourceSwitchCurrentPlayTime } from '@/features/play/lib/episodeResumePolicy';
import { resolvePlaybackLineSwitch } from '@/features/play/lib/playbackLines';
import type { ResumeMode } from '@/features/play/lib/resumePlayback';
import { showToast } from '@/lib/toast';
import { SearchResult } from '@/lib/types';

interface UseEpisodeSwitchOptions {
  artPlayerRef: RefObject<Artplayer | null>;
  detailRef: RefObject<SearchResult | null>;
  currentEpisodeIndexRef: RefObject<number>;
  resumeTimeRef: RefObject<number | null>;
  resumeModeRef: RefObject<ResumeMode>;
  stableCurrentTimeRef: RefObject<number>;
  clearTargetEpisodeProgressRef: RefObject<boolean>;
  sourceSwitchEpisodeAnchorRef: RefObject<SourceSwitchEpisodeAnchor | null>;
  playbackRequestModeRef: RefObject<PlaybackRequestMode>;
  doSaveCurrentProgress: () => void | Promise<unknown>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsVideoLoading: Dispatch<SetStateAction<boolean>>;
  setVideoLoadingStage: Dispatch<SetStateAction<VideoLoadingStage>>;
  setVideoLoadingAttempt: Dispatch<SetStateAction<number>>;
  setRealtimeLoadSpeed: Dispatch<SetStateAction<string>>;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
  setDetail: Dispatch<SetStateAction<SearchResult | null>>;
}

interface EpisodeSwitchHandlers {
  switchEpisode: (
    targetEpisodeIndex: number,
    detail?: SearchResult,
    options?: { fromStart?: boolean },
  ) => void;
  handleEpisodeChange: (episodeNumber: number) => void;
  handlePreviousEpisode: () => void;
  handleNextEpisode: () => void;
  handlePlaybackLineChange: (key: string, options?: { auto?: boolean }) => void;
}

export function useEpisodeSwitch({
  artPlayerRef,
  detailRef,
  currentEpisodeIndexRef,
  resumeTimeRef,
  resumeModeRef,
  stableCurrentTimeRef,
  clearTargetEpisodeProgressRef,
  sourceSwitchEpisodeAnchorRef,
  playbackRequestModeRef,
  doSaveCurrentProgress,
  setError,
  setIsVideoLoading,
  setVideoLoadingStage,
  setVideoLoadingAttempt,
  setRealtimeLoadSpeed,
  setCurrentEpisodeIndex,
  setDetail,
}: UseEpisodeSwitchOptions): EpisodeSwitchHandlers {
  const switchEpisode = useCallback(
    (
      targetEpisodeIndex: number,
      nextDetail?: SearchResult,
      options?: { fromStart?: boolean },
    ) => {
      const d = nextDetail || detailRef.current;
      if (!d?.episodes || targetEpisodeIndex < 0) {
        return;
      }

      if (targetEpisodeIndex >= d.episodes.length) {
        return;
      }

      if (
        targetEpisodeIndex === currentEpisodeIndexRef.current &&
        !nextDetail
      ) {
        return;
      }

      const samePlaybackUrl =
        !options?.fromStart &&
        nextDetail &&
        detailRef.current?.episodes[currentEpisodeIndexRef.current] ===
          nextDetail.episodes[targetEpisodeIndex];
      const inheritedResumeTime =
        !options?.fromStart &&
        (nextDetail ||
          shouldInheritCrossGroupProgress(
            d,
            currentEpisodeIndexRef.current,
            targetEpisodeIndex,
          ))
          ? Math.floor(
              resolveSourceSwitchCurrentPlayTime({
                playerCurrentTime: artPlayerRef.current?.currentTime || 0,
                pendingResumeTime: resumeTimeRef.current,
                stableCurrentTime: stableCurrentTimeRef.current,
              }),
            )
          : 0;

      doSaveCurrentProgress();
      if (nextDetail) {
        detailRef.current = nextDetail;
        setDetail(nextDetail);
        saveDetailSnapshot(nextDetail.source, nextDetail.id, nextDetail);
      }
      if (samePlaybackUrl) {
        currentEpisodeIndexRef.current = targetEpisodeIndex;
        setCurrentEpisodeIndex(targetEpisodeIndex);
        return;
      }
      sourceSwitchEpisodeAnchorRef.current = null;
      playbackRequestModeRef.current = 'episode';
      clearTargetEpisodeProgressRef.current = true;
      stableCurrentTimeRef.current = 0;
      resumeTimeRef.current = inheritedResumeTime > 1 ? inheritedResumeTime : 0;
      resumeModeRef.current = inheritedResumeTime > 1 ? 'forced' : null;
      currentEpisodeIndexRef.current = targetEpisodeIndex;

      setError(null);
      setIsVideoLoading(true);
      setVideoLoadingStage('episodeChanging');
      setVideoLoadingAttempt((prev) => prev + 1);
      setRealtimeLoadSpeed(
        nextDetail ? '正在切换播放线路...' : '正在切换剧集...',
      );
      setCurrentEpisodeIndex(targetEpisodeIndex);
    },
    [
      artPlayerRef,
      detailRef,
      currentEpisodeIndexRef,
      resumeTimeRef,
      resumeModeRef,
      stableCurrentTimeRef,
      clearTargetEpisodeProgressRef,
      sourceSwitchEpisodeAnchorRef,
      playbackRequestModeRef,
      doSaveCurrentProgress,
      setError,
      setIsVideoLoading,
      setVideoLoadingStage,
      setVideoLoadingAttempt,
      setRealtimeLoadSpeed,
      setCurrentEpisodeIndex,
      setDetail,
    ],
  );

  const handleEpisodeChange = useCallback(
    (episodeNumber: number) => {
      switchEpisode(episodeNumber);
    },
    [switchEpisode],
  );

  const handlePreviousEpisode = useCallback(() => {
    switchEpisode(currentEpisodeIndexRef.current - 1);
  }, [switchEpisode, currentEpisodeIndexRef]);

  const handleNextEpisode = useCallback(() => {
    switchEpisode(currentEpisodeIndexRef.current + 1);
  }, [switchEpisode, currentEpisodeIndexRef]);

  const handlePlaybackLineChange = useCallback(
    (key: string, options?: { auto?: boolean }) => {
      const detail = detailRef.current;
      if (!detail || detail.playback_line === key) return;
      const target = resolvePlaybackLineSwitch(
        detail,
        currentEpisodeIndexRef.current,
        key,
      );
      if (!target) {
        showToast('该线路缺少当前剧集，已保留当前播放', 'notice');
        return;
      }
      if (options?.auto) {
        const label =
          detail.playback_lines?.find((line) => line.key === key)?.label || key;
        showToast(`当前线路播放失败，已切换线路「${label}」`, 'notice');
      }
      switchEpisode(target.episodeIndex, target.detail);
    },
    [detailRef, currentEpisodeIndexRef, switchEpisode],
  );

  return {
    switchEpisode,
    handleEpisodeChange,
    handlePreviousEpisode,
    handleNextEpisode,
    handlePlaybackLineChange,
  };
}
