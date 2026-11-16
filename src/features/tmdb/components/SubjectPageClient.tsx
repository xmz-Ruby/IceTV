'use client';

import { Play, RotateCcw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import PageLayout from '@/components/PageLayout';
import { SeasonEpisodeSection } from '@/features/tmdb/components/SeasonEpisodeSection';
import { SourceMatchPanel } from '@/features/tmdb/components/SourceMatchPanel';
import {
  inferInitialSeason,
  parseSeasonMarker,
  parseTmdbYear,
} from '@/features/tmdb/lib/resolve';
import type { TmdbEpisodeTarget } from '@/features/tmdb/lib/source-episode-match';
import {
  describeTmdbClientError,
  fetchTmdbMovieDetail,
  fetchTmdbSeasonDetail,
  fetchTmdbShowDetail,
  resolveBestTmdbMatch,
  resolveTmdbClientSettings,
} from '@/features/tmdb/lib/tmdb-client';
import { tmdbImageUrl } from '@/features/tmdb/lib/tmdb-image-url';
import type {
  TmdbEpisode,
  TmdbMovieDetail,
  TmdbResolveMatch,
  TmdbSeasonDetail,
  TmdbShowDetail,
} from '@/features/tmdb/types';
import {
  getCurrentNavigationPath,
  withReturnTo,
} from '@/lib/navigation-return';
import { findLocalPlaybackTargetByTitle } from '@/lib/video-prefetch';

type SubjectPhase = 'resolving' | 'ready' | 'fallback';

interface SeasonEpisodesState {
  data: TmdbSeasonDetail | null;
  loading: boolean;
  error: boolean;
}

function formatRating(vote: number): string {
  return vote > 0 ? vote.toFixed(1) : '';
}

export function SubjectPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const title = (searchParams.get('title') || '').trim();
  const year = (searchParams.get('year') || '').trim();
  const stype = searchParams.get('stype') === 'movie' ? 'movie' : 'tv';
  const doubanPoster = searchParams.get('poster') || '';

  const [phase, setPhase] = useState<SubjectPhase>('resolving');
  const [fallbackReason, setFallbackReason] = useState('');
  const [match, setMatch] = useState<TmdbResolveMatch | null>(null);
  const [strippedTitle, setStrippedTitle] = useState('');
  const [showDetail, setShowDetail] = useState<TmdbShowDetail | null>(null);
  const [movieDetail, setMovieDetail] = useState<TmdbMovieDetail | null>(null);
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<SeasonEpisodesState>({
    data: null,
    loading: false,
    error: false,
  });
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTarget, setPanelTarget] = useState<TmdbEpisodeTarget | null>(
    null,
  );
  const [localTarget, setLocalTarget] = useState<{
    source: string;
    id: string;
  } | null>(null);

  const seasonCacheRef = useRef(new Map<number, TmdbSeasonDetail>());

  // ① 豆瓣条目 → TMDB 匹配（浏览器直连用户本地设置的 TMDB）
  useEffect(() => {
    if (!title) {
      setPhase('fallback');
      setFallbackReason('缺少标题参数');
      return;
    }

    const controller = new AbortController();
    resolveBestTmdbMatch(title, year, stype, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.status === 'ok' && data.match) {
          setMatch(data.match);
          setStrippedTitle(data.strippedTitle || title);
          setPhase('ready');
        } else {
          setPhase('fallback');
          setFallbackReason(
            data.status === 'disabled'
              ? '未启用 TMDB 详情页，可在 本地设置 → TMDB 中开启'
              : data.status === 'no-match'
                ? 'TMDB 未匹配到该剧目'
                : 'TMDB 请求失败',
          );
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPhase('fallback');
        setFallbackReason(
          describeTmdbClientError(error, 'TMDB 请求失败，请稍后重试'),
        );
        console.error('TMDB resolve 失败:', error);
      });

    return () => controller.abort();
  }, [title, stype, year]);

  // ② tv 拉详情并推断初始季
  useEffect(() => {
    if (phase !== 'ready' || !match || match.mediaType !== 'tv') return;
    const settings = resolveTmdbClientSettings();
    if (!settings) {
      setPhase('fallback');
      setFallbackReason('未启用 TMDB 详情页，可在 本地设置 → TMDB 中开启');
      return;
    }

    const controller = new AbortController();
    fetchTmdbShowDetail(settings, match.id, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setShowDetail(detail);
        const initial = inferInitialSeason(detail.seasons, {
          markerSeason: parseSeasonMarker(title),
          doubanYear: year,
        });
        setSelectedSeason(initial > 0 ? initial : 1);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPhase('fallback');
        setFallbackReason(describeTmdbClientError(error, 'TMDB 详情获取失败'));
        console.error('TMDB tv 详情失败:', error);
      });

    return () => controller.abort();
  }, [phase, match, title, year]);

  // ③ movie 拉详情
  useEffect(() => {
    if (phase !== 'ready' || !match || match.mediaType !== 'movie') return;
    const settings = resolveTmdbClientSettings();
    if (!settings) return;

    const controller = new AbortController();
    fetchTmdbMovieDetail(settings, match.id, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setMovieDetail(detail);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('TMDB movie 详情失败:', error);
      });

    return () => controller.abort();
  }, [phase, match]);

  // ④ 当前季的集列表（客户端缓存，切季即时回显；模块级会话缓存叠加防重打）
  useEffect(() => {
    if (phase !== 'ready' || !showDetail || match?.mediaType !== 'tv') return;

    const cached = seasonCacheRef.current.get(selectedSeason);
    if (cached) {
      setSeasonEpisodes({ data: cached, loading: false, error: false });
      return;
    }

    const settings = resolveTmdbClientSettings();
    if (!settings) {
      setSeasonEpisodes({ data: null, loading: false, error: true });
      return;
    }

    const controller = new AbortController();
    setSeasonEpisodes({ data: null, loading: true, error: false });
    fetchTmdbSeasonDetail(
      settings,
      showDetail.id,
      selectedSeason,
      controller.signal,
    )
      .then((detail) => {
        if (controller.signal.aborted) return;
        seasonCacheRef.current.set(selectedSeason, detail);
        setSeasonEpisodes({ data: detail, loading: false, error: false });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSeasonEpisodes({ data: null, loading: false, error: true });
        console.error('TMDB 季集失败:', error);
      });

    return () => controller.abort();
  }, [phase, showDetail, match?.mediaType, selectedSeason]);

  // 本地观看记录命中 → 继续观看
  useEffect(() => {
    if (!title) return;
    setLocalTarget(findLocalPlaybackTargetByTitle(title, year));
  }, [title, year]);

  const visibleSeasons = useMemo(() => {
    if (!showDetail) return [];
    const regular = showDetail.seasons.filter(
      (season) => season.season_number > 0 && season.episode_count > 0,
    );
    if (regular.length > 0) return regular;
    return showDetail.seasons.filter((season) => season.season_number > 0);
  }, [showDetail]);

  const priorEpisodes = useMemo(() => {
    if (!showDetail) return 0;
    return showDetail.seasons
      .filter(
        (season) =>
          season.season_number > 0 && season.season_number < selectedSeason,
      )
      .reduce((sum, season) => sum + season.episode_count, 0);
  }, [showDetail, selectedSeason]);

  const seasonEpisodeCount = useMemo(() => {
    const summary = visibleSeasons.find(
      (season) => season.season_number === selectedSeason,
    );
    if (summary?.episode_count) return summary.episode_count;
    return seasonEpisodes.data?.episodes.length || 0;
  }, [visibleSeasons, selectedSeason, seasonEpisodes.data]);

  const currentSeasonThemeNames = useMemo(() => {
    const summary = visibleSeasons.find(
      (season) => season.season_number === selectedSeason,
    );
    if (!summary) return undefined;
    const name = (summary.name || '').trim();
    return name ? [name] : undefined;
  }, [visibleSeasons, selectedSeason]);

  const showYear = useMemo(() => {
    if (match?.mediaType === 'movie' && movieDetail?.release_date) {
      return String(parseTmdbYear(movieDetail.release_date));
    }
    if (showDetail?.first_air_date) {
      return String(parseTmdbYear(showDetail.first_air_date));
    }
    return year;
  }, [match?.mediaType, movieDetail, showDetail, year]);

  const searchKeyword = strippedTitle || title;

  const openPanelForEpisode = useCallback(
    (episode: TmdbEpisode) => {
      setPanelTarget({
        season: selectedSeason,
        episode: episode.episode_number,
        airDate: episode.air_date || '',
        episodeName: episode.name || '',
        seasonEpisodeCount,
        priorEpisodes,
        strippedTitle: searchKeyword,
        showYear,
        seasonThemeNames: currentSeasonThemeNames,
      });
      setPanelOpen(true);
    },
    [
      selectedSeason,
      seasonEpisodeCount,
      priorEpisodes,
      searchKeyword,
      showYear,
      currentSeasonThemeNames,
    ],
  );

  const openPanelForMovie = useCallback(() => {
    setPanelTarget({
      season: 0,
      episode: 1,
      airDate: '',
      episodeName: '',
      seasonEpisodeCount: 1,
      priorEpisodes: 0,
      strippedTitle: searchKeyword,
      showYear,
    });
    setPanelOpen(true);
  }, [searchKeyword, showYear]);

  const goLegacyPlay = useCallback(() => {
    const params = new URLSearchParams({ title });
    if (year) params.set('year', year);
    if (stype) params.set('stype', stype);
    router.push(
      withReturnTo(`/play?${params.toString()}`, getCurrentNavigationPath()),
    );
  }, [router, title, year, stype]);

  const goContinueWatching = useCallback(() => {
    if (!localTarget) return;
    const params = new URLSearchParams({
      source: localTarget.source,
      id: localTarget.id,
      title,
    });
    if (year) params.set('year', year);
    if (stype) params.set('stype', stype);
    router.push(
      withReturnTo(`/play?${params.toString()}`, getCurrentNavigationPath()),
    );
  }, [localTarget, router, title, year, stype]);

  // 登录后本页自带外壳（AuthenticatedRoute 只在门禁态包 PageLayout）：
  // 顶栏、返回按钮与底部导航由 PageLayout 统一提供
  const renderInShell = (children: ReactNode) => (
    <PageLayout activePath='/subject' showDesktopBack mobileHeader={{ title }}>
      {children}
    </PageLayout>
  );

  // ── 兜底视图：TMDB 不可用/未匹配，保留旧链路入口，永不死路
  if (phase === 'fallback') {
    return renderInShell(
      <div className='mx-auto w-full max-w-[1680px] px-4 pt-10 sm:px-6 lg:px-8'>
        <div className='flex flex-col gap-6 sm:flex-row'>
          {doubanPoster && (
            <img
              src={doubanPoster}
              alt={title}
              className='aspect-[2/3] w-32 shrink-0 rounded-lg object-cover sm:w-44'
            />
          )}
          <div className='min-w-0 flex-1 space-y-4 py-2'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              {title}
            </h1>
            <p className='text-sm text-gray-500 dark:text-gray-400'>
              {fallbackReason}
            </p>
            <div className='flex flex-wrap gap-3'>
              <button
                type='button'
                onClick={goLegacyPlay}
                className='inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700'
              >
                <Play aria-hidden='true' className='h-4 w-4' />
                直接搜索播放
              </button>
              <button
                type='button'
                onClick={() => router.refresh()}
                className='inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              >
                <RotateCcw aria-hidden='true' className='h-4 w-4' />
                重试
              </button>
            </div>
            {localTarget && (
              <button
                type='button'
                onClick={goContinueWatching}
                className='text-sm text-brand-600 hover:underline dark:text-brand-400'
              >
                继续观看（上次播放的源）
              </button>
            )}
          </div>
        </div>
      </div>,
    );
  }

  if (phase === 'resolving' || !match) {
    return renderInShell(
      <div
        aria-busy='true'
        className='flex min-h-[50vh] items-center justify-center text-sm text-gray-500 dark:text-gray-400'
      >
        正在匹配 TMDB...
      </div>,
    );
  }

  const isMovie = match.mediaType === 'movie';
  const heroPoster = isMovie
    ? movieDetail?.poster_path
      ? tmdbImageUrl(movieDetail.poster_path, 'w342')
      : doubanPoster
    : showDetail?.poster_path
      ? tmdbImageUrl(showDetail.poster_path, 'w342')
      : doubanPoster;
  const heroBackdrop = isMovie
    ? movieDetail?.backdrop_path
    : showDetail?.backdrop_path;
  const heroTitle = isMovie
    ? movieDetail?.title || title
    : showDetail?.name || title;
  const heroDate = isMovie
    ? movieDetail?.release_date
    : showDetail?.first_air_date;
  const heroGenres = (isMovie ? movieDetail?.genres : showDetail?.genres) || [];
  const heroVote = isMovie
    ? movieDetail?.vote_average
    : showDetail?.vote_average;
  const heroOverview = isMovie ? movieDetail?.overview : showDetail?.overview;

  return renderInShell(
    <div className='mx-auto w-full max-w-[1680px] px-4 pb-16 pt-6 sm:px-6 lg:px-8'>
      <div className='relative -mx-4 sm:-mx-6 lg:-mx-8'>
        {heroBackdrop && (
          <div className='absolute inset-x-0 top-0 h-64 overflow-hidden sm:h-80'>
            <img
              src={tmdbImageUrl(heroBackdrop, 'w1280')}
              alt=''
              aria-hidden='true'
              className='h-full w-full object-cover opacity-40'
            />
            <div className='absolute inset-0 bg-gradient-to-b from-transparent via-white/40 to-white dark:via-gray-950/60 dark:to-gray-950' />
          </div>
        )}
      </div>

      <div className='relative flex flex-col gap-6 sm:flex-row'>
        {heroPoster && (
          <img
            src={heroPoster}
            alt={heroTitle}
            className='aspect-[2/3] w-32 shrink-0 rounded-lg object-cover shadow-lg sm:w-44'
          />
        )}
        <div className='min-w-0 flex-1 space-y-3 py-1'>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              {heroTitle}
            </h1>
            {formatRating(heroVote || 0) && (
              <span className='text-sm font-medium text-yellow-600 dark:text-yellow-500'>
                ★ {formatRating(heroVote || 0)}
              </span>
            )}
          </div>
          <p className='text-sm text-gray-500 dark:text-gray-400'>
            {[
              heroDate?.slice(0, 4),
              ...heroGenres.slice(0, 4),
              isMovie
                ? ''
                : showDetail
                  ? `${showDetail.number_of_seasons}季 · ${showDetail.number_of_episodes}集`
                  : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {heroOverview && (
            <p className='line-clamp-4 max-w-3xl text-sm leading-relaxed text-gray-600 dark:text-gray-300'>
              {heroOverview}
            </p>
          )}
          <div className='flex flex-wrap gap-3 pt-2'>
            {isMovie ? (
              <button
                type='button'
                onClick={openPanelForMovie}
                className='inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700'
              >
                <Play aria-hidden='true' className='h-4 w-4' />
                播放
              </button>
            ) : null}
            {localTarget && (
              <button
                type='button'
                onClick={goContinueWatching}
                className='inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
              >
                继续观看
              </button>
            )}
          </div>
        </div>
      </div>

      {!isMovie && showDetail && (
        <SeasonEpisodeSection
          seasons={visibleSeasons}
          selectedSeason={selectedSeason}
          onSeasonChange={setSelectedSeason}
          episodes={seasonEpisodes.data?.episodes ?? null}
          loading={seasonEpisodes.loading}
          onEpisodeClick={openPanelForEpisode}
        />
      )}

      <SourceMatchPanel
        isOpen={panelOpen}
        searchTitle={searchKeyword}
        displayTitle={title || heroTitle}
        year={year}
        searchType={isMovie ? 'movie' : 'tv'}
        target={panelTarget}
        onClose={() => setPanelOpen(false)}
      />
    </div>,
  );
}
