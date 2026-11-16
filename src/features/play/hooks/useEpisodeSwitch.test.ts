import { act, renderHook } from '@testing-library/react';
import type Artplayer from 'artplayer';

import { useEpisodeSwitch } from '@/features/play/hooks/useEpisodeSwitch';
import { saveDetailSnapshot } from '@/features/play/lib/detailSnapshot';
import { showToast } from '@/lib/toast';
import type { SearchResult } from '@/lib/types';

jest.mock('@/features/play/lib/detailSnapshot', () => ({
  saveDetailSnapshot: jest.fn(),
}));
jest.mock('@/lib/toast', () => ({ showToast: jest.fn() }));

const detail: SearchResult = {
  id: '42',
  title: '测试剧',
  source: 'cms',
  source_name: 'CMS',
  year: '2026',
  poster: '',
  episodes: [
    'https://media.example/a/1.m3u8',
    'https://media.example/a/2.m3u8',
    'https://media.example/a/3.m3u8',
  ],
  episodes_titles: ['第1集', '第2集', '第3集'],
  playback_line: 'a:1',
  playback_lines: [
    {
      key: 'a:1',
      label: '流畅',
      episodes: [
        'https://media.example/a/1.m3u8',
        'https://media.example/a/2.m3u8',
        'https://media.example/a/3.m3u8',
      ],
      episodes_titles: ['第1集', '第2集', '第3集'],
    },
    {
      key: 'b:1',
      label: '蓝光',
      episodes: [
        'https://media.example/b/2.m3u8',
        'https://media.example/b/3.m3u8',
      ],
      episodes_titles: ['02', '03'],
    },
  ],
};

function options(): Parameters<typeof useEpisodeSwitch>[0] {
  return {
    artPlayerRef: { current: { currentTime: 125.9 } as Artplayer },
    detailRef: { current: detail },
    currentEpisodeIndexRef: { current: 1 },
    resumeTimeRef: { current: null },
    resumeModeRef: { current: null },
    stableCurrentTimeRef: { current: 120 },
    clearTargetEpisodeProgressRef: { current: false },
    sourceSwitchEpisodeAnchorRef: { current: null },
    playbackRequestModeRef: { current: 'initial' },
    doSaveCurrentProgress: jest.fn(),
    setError: jest.fn(),
    setIsVideoLoading: jest.fn(),
    setVideoLoadingStage: jest.fn(),
    setVideoLoadingAttempt: jest.fn(),
    setRealtimeLoadSpeed: jest.fn(),
    setCurrentEpisodeIndex: jest.fn(),
    setDetail: jest.fn(),
  };
}

beforeEach(() => jest.clearAllMocks());

it('切到另一条线路的同一集，继承进度并更新当前线路的分集清单', () => {
  const params = options();
  const { result } = renderHook(() => useEpisodeSwitch(params));
  act(() => result.current.handlePlaybackLineChange('b:1'));
  expect(params.currentEpisodeIndexRef.current).toBe(0);
  expect(params.detailRef.current?.episodes).toEqual(
    detail.playback_lines![1].episodes,
  );
  expect(params.detailRef.current?.playback_line).toBe('b:1');
  expect(params.resumeTimeRef.current).toBe(125);
  expect(params.resumeModeRef.current).toBe('forced');
  expect(params.doSaveCurrentProgress).toHaveBeenCalledTimes(1);
  expect(saveDetailSnapshot).toHaveBeenCalledWith(
    'cms',
    '42',
    params.detailRef.current,
  );

  act(() => result.current.handleNextEpisode());
  expect(params.currentEpisodeIndexRef.current).toBe(1);
  act(() => result.current.handleNextEpisode());
  expect(params.currentEpisodeIndexRef.current).toBe(1);
});

it('线路缺少当前集时保留原线路和进度，不跳到别的集', () => {
  const params = options();
  params.currentEpisodeIndexRef.current = 0;
  const { result } = renderHook(() => useEpisodeSwitch(params));
  act(() => result.current.handlePlaybackLineChange('b:1'));
  expect(params.detailRef.current).toBe(detail);
  expect(params.currentEpisodeIndexRef.current).toBe(0);
  expect(params.setDetail).not.toHaveBeenCalled();
  expect(params.doSaveCurrentProgress).not.toHaveBeenCalled();
  expect(showToast).toHaveBeenCalledWith(
    '该线路缺少当前剧集，已保留当前播放',
    'notice',
  );
});

it('同集索引不变时仍切换地址，快速切回时保留尚未恢复的进度', () => {
  const params = options();
  params.detailRef.current = {
    ...detail,
    playback_lines: detail.playback_lines!.map((line) => ({
      ...line,
      episodes: line.episodes.slice(0, 1),
      episodes_titles: ['正片'],
    })),
    episodes: [detail.episodes[0]],
    episodes_titles: ['正片'],
  };
  params.currentEpisodeIndexRef.current = 0;
  const { result } = renderHook(() => useEpisodeSwitch(params));
  act(() => result.current.handlePlaybackLineChange('b:1'));
  expect(params.currentEpisodeIndexRef.current).toBe(0);
  expect(params.detailRef.current?.playback_line).toBe('b:1');
  params.artPlayerRef.current = { currentTime: 0 } as Artplayer;
  act(() => result.current.handlePlaybackLineChange('a:1'));
  expect(params.detailRef.current?.playback_line).toBe('a:1');
  expect(params.resumeTimeRef.current).toBe(125);
  expect(params.setIsVideoLoading).toHaveBeenCalledTimes(2);
});

it('下一集切到同源另一线路时从头开始，上一集时间不继承', () => {
  const params = options();
  const { result } = renderHook(() => useEpisodeSwitch(params));
  const next = {
    ...detail,
    episodes: detail.playback_lines![1].episodes,
    episodes_titles: detail.playback_lines![1].episodes_titles,
    playback_line: 'b:1',
  };
  act(() => result.current.switchEpisode(1, next, { fromStart: true }));
  expect(params.resumeTimeRef.current).toBe(0);
  expect(params.stableCurrentTimeRef.current).toBe(0);
  expect(params.clearTargetEpisodeProgressRef.current).toBe(true);
  expect(params.doSaveCurrentProgress).toHaveBeenCalledTimes(1);
});

it('重复选择当前线路不会中断播放', () => {
  const params = options();
  const { result } = renderHook(() => useEpisodeSwitch(params));
  act(() => result.current.handlePlaybackLineChange('a:1'));
  expect(params.setDetail).not.toHaveBeenCalled();
  expect(params.setIsVideoLoading).not.toHaveBeenCalled();
});
