'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  MODAL_CLOSE_BUTTON_CLASS,
  MODAL_SECONDARY_BUTTON_CLASS,
} from '@/components/modals/modal-styles';
import ModalShell from '@/components/modals/ModalShell';
import Spinner from '@/components/Spinner';
import {
  type SourceEpisodeMatchResult,
  type TmdbEpisodeTarget,
  matchSourceEntryForEpisode,
  rankSourceEpisodeMatches,
} from '@/features/tmdb/lib/source-episode-match';
import { resolveEpisodeGroupPosition } from '@/lib/episode-groups';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { savePlayIntent } from '@/lib/play-intent';
import type { SearchResult } from '@/lib/types';

const AUTO_PLAY_COUNTDOWN_SECONDS = 5;

interface SourceMatchPanelProps {
  isOpen: boolean;
  /** 源检索关键词（剥季标记后的剧名） */
  searchTitle: string;
  /** 详情页展示用标题（豆瓣条目名） */
  displayTitle: string;
  year: string;
  /** stype：tv | movie */
  searchType: string;
  mediaKey: string;
  target: TmdbEpisodeTarget | null;
  onClose: () => void;
}

function buildPlayUrl(
  item: SourceEpisodeMatchResult,
  context: { searchTitle: string; year: string; searchType: string },
): string {
  const params = new URLSearchParams({
    source: item.result.source,
    id: item.result.id,
    title: item.result.title,
    stitle: context.searchTitle,
  });
  if (context.year) params.set('year', context.year);
  if (context.searchType) params.set('stype', context.searchType);
  params.set('directStart', 'true');
  return `/play?${params.toString()}`;
}

export function SourceMatchPanel({
  isOpen,
  searchTitle,
  displayTitle,
  year,
  searchType,
  mediaKey,
  target,
  onClose,
}: SourceMatchPanelProps) {
  const router = useRouter();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [played, setPlayed] = useState(false);
  const fetchSeqRef = useRef(0);

  const matches = useMemo<SourceEpisodeMatchResult[]>(() => {
    if (!target || results.length === 0) return [];
    const list = results.map((result) =>
      matchSourceEntryForEpisode(result, target),
    );
    return rankSourceEpisodeMatches(list);
  }, [results, target]);

  const topMatched = useMemo(
    () => matches.find((item) => item.status === 'matched') ?? null,
    [matches],
  );

  const goToPlay = useCallback(
    (item: SourceEpisodeMatchResult) => {
      if (item.status !== 'matched' || item.episodeIndex === null || !target)
        return;
      setPlayed(true);
      setCountdown(null);
      // 定位到具体集：写一次性播放意图，播放页历史恢复会优先消费（压过播放记录），
      // 且详情就绪后才应用（集数/分组换算正确），避免另造 URL 参数被刷新重放。
      const group = resolveEpisodeGroupPosition(
        item.result.episode_groups,
        item.episodeIndex,
        item.result.episodes.length,
      );
      savePlayIntent({
        source: item.result.source,
        id: item.result.id,
        episodeIndex: item.episodeIndex,
        resumeTime: 0,
        ...(group
          ? {
              groupLabel: item.result.episode_groups?.[group.groupIndex]?.label,
              groupIndex: group.episodeOffset + 1,
              groupTotal: group.groupCount,
            }
          : {}),
        tmdbCoordinate: {
          media_key: mediaKey,
          season: target.season,
          episode: target.episode,
          source: item.result.source,
          video_id: item.result.id,
          source_episode_index: item.episodeIndex + 1,
        },
      });
      const url = withReturnTo(
        buildPlayUrl(item, { searchTitle, year, searchType }),
        getCurrentNavigationPath(),
      );
      router.push(url);
    },
    [mediaKey, router, searchTitle, searchType, target, year],
  );

  const runSearch = useCallback(
    (retryOfSeq?: number) => {
      const seq = retryOfSeq ?? (fetchSeqRef.current += 1);
      setLoading(true);
      setError('');
      setResults([]);
      fetch(`/api/search?q=${encodeURIComponent(searchTitle.trim())}`)
        .then(async (response) => {
          if (!response.ok) throw new Error('搜索失败');
          const data = (await response.json()) as { results?: SearchResult[] };
          if (seq !== fetchSeqRef.current) return;
          setResults(Array.isArray(data.results) ? data.results : []);
        })
        .catch((err: unknown) => {
          if (seq !== fetchSeqRef.current) return;
          setError(err instanceof Error ? err.message : '搜索失败');
        })
        .finally(() => {
          if (seq === fetchSeqRef.current) setLoading(false);
        });
    },
    [searchTitle],
  );

  // 打开面板时聚合搜索；关键词变化或重新打开都重跑
  useEffect(() => {
    if (!isOpen || !searchTitle || !target) return;
    setPlayed(false);
    setCountdown(null);
    runSearch();
  }, [isOpen, searchTitle, target, runSearch]);

  // 首个命中源倒计时自动播放，任意点击/关闭打断（对齐手机版校验页）
  useEffect(() => {
    if (!isOpen || loading || played || error || !topMatched) return;

    setCountdown(AUTO_PLAY_COUNTDOWN_SECONDS);
    const timer = window.setInterval(() => {
      setCountdown((previous) => {
        if (previous === null) return null;
        if (previous <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen, loading, played, error, topMatched]);

  useEffect(() => {
    if (!isOpen || countdown !== 0 || played || !topMatched) return;
    goToPlay(topMatched);
  }, [countdown, goToPlay, isOpen, played, topMatched]);

  const cancelCountdown = useCallback(() => setCountdown(null), []);

  const episodeLabel = target
    ? target.season > 0
      ? `第${target.season}季 第${target.episode}集`
      : '电影'
    : '';

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={() => {
        cancelCountdown();
        onClose();
      }}
      panelClassName='flex h-full max-h-[640px] max-w-2xl flex-col !rounded-xl border border-gray-200 dark:border-gray-700'
    >
      <div className='flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700'>
        <div className='min-w-0'>
          <h2 className='truncate text-base font-semibold text-gray-900 dark:text-gray-100'>
            片源匹配
          </h2>
          <p className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
            {displayTitle}
            {episodeLabel ? ` · ${episodeLabel}` : ''}
            {target?.episodeName ? ` · ${target.episodeName}` : ''}
          </p>
        </div>
        {countdown !== null && countdown > 0 && topMatched && (
          <button
            type='button'
            onClick={() => goToPlay(topMatched)}
            className='shrink-0 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700'
          >
            {countdown}s 后播放「{topMatched.result.source_name}」，点击立即播放
          </button>
        )}
        <button
          type='button'
          aria-label='关闭片源匹配'
          className={MODAL_CLOSE_BUTTON_CLASS}
          onClick={() => {
            cancelCountdown();
            onClose();
          }}
        >
          <X aria-hidden='true' className='h-4 w-4' />
        </button>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-2'>
        {loading && (
          <div className='flex items-center justify-center gap-2 py-10 text-sm text-gray-500 dark:text-gray-400'>
            <Spinner className='h-4 w-4' />
            正在检索片源...
          </div>
        )}
        {!loading && error && (
          <div className='space-y-3 py-10 text-center'>
            <p className='text-sm text-gray-500 dark:text-gray-400'>{error}</p>
            <button
              type='button'
              onClick={() => runSearch()}
              className='rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
            >
              重试
            </button>
          </div>
        )}
        {!loading && !error && matches.length === 0 && (
          <p className='py-10 text-center text-sm text-gray-500 dark:text-gray-400'>
            没有检索到相关片源
          </p>
        )}
        {!loading && !error && !topMatched && (
          <div className='space-y-3 py-4 text-center'>
            <p className='text-sm text-gray-500 dark:text-gray-400'>
              当前片源未找到这一集，可重新校验或返回选择其他剧集
            </p>
            <button
              type='button'
              onClick={() => runSearch()}
              className={MODAL_SECONDARY_BUTTON_CLASS}
            >
              重新校验
            </button>
          </div>
        )}
        {!loading &&
          matches.map((item) => {
            const playable =
              item.status === 'matched' && item.episodeIndex !== null;
            return (
              <button
                key={`${item.result.source}-${item.result.id}`}
                type='button'
                disabled={!playable || played}
                onClick={() => playable && goToPlay(item)}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                  playable
                    ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-white/[0.06]'
                    : 'cursor-default'
                } ${played ? 'opacity-60' : ''}`}
              >
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {item.result.title}
                  </p>
                  <p className='mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400'>
                    {item.result.source_name}
                    {item.result.episodes.length > 0
                      ? ` · ${item.result.episodes.length}集`
                      : ''}
                    {item.result.year && item.result.year !== 'unknown'
                      ? ` · ${item.result.year}`
                      : ''}
                  </p>
                </div>
                <span
                  className={`max-w-[9rem] shrink-0 truncate rounded-full px-2 py-1 text-xs ${
                    item.status === 'matched'
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                      : item.status === 'other-season'
                        ? 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
                        : 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300'
                  }`}
                  title={item.note}
                >
                  {item.note}
                </span>
              </button>
            );
          })}
      </div>
    </ModalShell>
  );
}
