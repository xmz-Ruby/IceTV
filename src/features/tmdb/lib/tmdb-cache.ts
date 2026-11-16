import 'server-only';

import type {
  TmdbMovieDetail,
  TmdbResolveResponse,
  TmdbSeasonDetail,
  TmdbShowDetail,
} from '@/features/tmdb/types';
import { createSharedServerCache } from '@/lib/shared-server-cache';

// TMDB 响应缓存：跨实例落 shared_cache 表，SWR 语义（新鲜直返/过期回旧值后台刷新）。
// 改动任一响应结构时同步升版本号。
export const tmdbResolveCache = createSharedServerCache<TmdbResolveResponse>({
  name: 'tmdb-resolve-v1',
  maxSize: 512,
  freshMs: 30 * 60 * 1000,
  staleMs: 24 * 60 * 60 * 1000,
  // 网络错误不缓存；disabled（刚开/刚关开关）也不缓存，否则管理员开启 TMDB 后
  // 用户在 TTL 内仍拿到 disabled；readRecord 回读同样按此复核，旧条目自动失效
  shouldCache: (value) => value.status === 'ok' || value.status === 'no-match',
});

export const tmdbShowCache = createSharedServerCache<TmdbShowDetail>({
  name: 'tmdb-tv-v1',
  maxSize: 512,
  freshMs: 6 * 60 * 60 * 1000,
  staleMs: 24 * 60 * 60 * 1000,
  shouldCache: (value) => value.id > 0 && !!value.name,
});

export const tmdbMovieCache = createSharedServerCache<TmdbMovieDetail>({
  name: 'tmdb-movie-v1',
  maxSize: 512,
  freshMs: 6 * 60 * 60 * 1000,
  staleMs: 24 * 60 * 60 * 1000,
  shouldCache: (value) => value.id > 0 && !!value.title,
});

// 连播剧每集更新，季数据保鲜期短于详情
export const tmdbSeasonCache = createSharedServerCache<TmdbSeasonDetail>({
  name: 'tmdb-season-v1',
  maxSize: 1024,
  freshMs: 30 * 60 * 1000,
  staleMs: 6 * 60 * 60 * 1000,
  shouldCache: (value) => value.showId > 0 && value.episodes.length > 0,
});
