'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import {
  warmupDanmakuForNavigation,
  warmupDanmakuSearchForNavigation,
} from '@/features/play/lib/danmaku/navigation-warmup';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth.client';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import {
  buildSubjectPageUrl,
  isTmdbSubjectEntryEnabled,
} from '@/lib/subject-navigation';
import {
  canUseHoverPrefetch,
  canUseNetworkPrefetch,
  findLocalPlaybackTargetByTitle,
  PREFETCH_INTENT_DELAY_MS,
  transferWarmedSearchToAggregateGroup,
  warmupSearchForTitle,
} from '@/lib/video-prefetch';

interface PosterPlayTarget {
  title: string;
  year?: string;
  type?: string;
  doubanId?: number | string;
  poster?: string;
}

// 按标题起播的海报类入口（豆瓣/Bangumi 卡片、首页精选）共用的跳转与预热
export function usePosterPlay({
  title,
  year,
  type = '',
  doubanId,
  poster,
}: PosterPlayTarget) {
  const router = useRouter();
  const prefetchTimerRef = useRef<number | null>(null);

  const buildPlayUrl = useCallback(() => {
    const localTarget = findLocalPlaybackTargetByTitle(title, year);
    if (localTarget) {
      return `/play?source=${encodeURIComponent(localTarget.source)}&id=${encodeURIComponent(
        localTarget.id,
      )}&title=${encodeURIComponent(title.trim())}${
        year ? `&year=${year}` : ''
      }${type ? `&stype=${type}` : ''}`;
    }

    return `/play?title=${encodeURIComponent(title.trim())}${
      year ? `&year=${year}` : ''
    }${type ? `&stype=${type}` : ''}`;
  }, [title, type, year]);

  const warmupDanmaku = useCallback(() => {
    const localTarget = findLocalPlaybackTargetByTitle(title, year);
    void warmupDanmakuForNavigation({
      source: localTarget?.source ?? '',
      videoId: localTarget?.id ?? '',
      episodeIndex: 0,
      searchTitle: title,
      searchYear: year || '',
    });
  }, [title, year]);

  const play = useCallback(() => {
    // TMDB 开启时先进详情页选季选集（本地观看记录的「继续观看」由详情页提供），
    // 弹幕/搜索预热留给旧链路——详情页的源匹配面板会用自己的检索词
    if (isTmdbSubjectEntryEnabled()) {
      router.push(
        withReturnTo(
          buildSubjectPageUrl({ title, year, type, doubanId, poster }),
          getCurrentNavigationPath(),
        ),
      );
      return;
    }

    const playUrl = withReturnTo(buildPlayUrl(), getCurrentNavigationPath());
    const authInfo = getAuthInfoFromBrowserCookie();
    if (authInfo?.username) {
      const hasLocalTarget = !!findLocalPlaybackTargetByTitle(title, year);
      if (canUseNetworkPrefetch()) {
        warmupDanmaku();
        if (!hasLocalTarget) {
          transferWarmedSearchToAggregateGroup(title);
          warmupSearchForTitle(title);
        }
      }
    }
    router.push(playUrl);
  }, [
    buildPlayUrl,
    doubanId,
    poster,
    router,
    title,
    type,
    warmupDanmaku,
    year,
  ]);

  // hover / focus 预热：提前触发标题聚合搜索并预取播放页路由
  const prefetch = useCallback(() => {
    if (!canUseHoverPrefetch()) return;

    if (isTmdbSubjectEntryEnabled()) {
      router.prefetch('/subject');
      return;
    }
    router.prefetch('/play');
    if (prefetchTimerRef.current) {
      window.clearTimeout(prefetchTimerRef.current);
    }
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = null;
      void warmupDanmakuSearchForNavigation(title);
      warmupSearchForTitle(title);
    }, PREFETCH_INTENT_DELAY_MS);
  }, [router, title]);

  const cancelPrefetch = useCallback(() => {
    if (!prefetchTimerRef.current) return;
    window.clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = null;
  }, []);

  useEffect(() => cancelPrefetch, [cancelPrefetch]);

  return { play, prefetch, cancelPrefetch };
}

export function buildExternalSubjectUrl(
  subjectId?: number,
  isBangumi = false,
): string | null {
  if (!subjectId) {
    return null;
  }

  return isBangumi
    ? `https://bgm.tv/subject/${subjectId.toString()}`
    : `https://movie.douban.com/subject/${subjectId.toString()}`;
}

// 上游未评分时返回 0 或空串，这类值不展示
export function hasDisplayableRate(rate?: string): rate is string {
  return !!rate && Number.parseFloat(rate) > 0;
}
