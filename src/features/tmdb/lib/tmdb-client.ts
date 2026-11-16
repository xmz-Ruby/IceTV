// TMDB 浏览器直连客户端：配置为「用户本地设置 + 站点级 env 默认」的合并结果，不经服务端中转。
// 官方 api.themoviedb.org 支持跨域（v3 api_key query 是简单请求；v4 Bearer 有预检且放行
// Authorization 头）。自定义镜像 host 必须自行支持 CORS，网络/CORS 失败统一表现为 network 错误。
import {
  buildResolveQueries,
  isTmdbMatchScore,
  scoreTmdbCandidate,
  stripSeasonMarker,
} from '@/features/tmdb/lib/resolve';
import type {
  TmdbMediaType,
  TmdbMovieDetail,
  TmdbResolveMatch,
  TmdbResolveResponse,
  TmdbSearchCandidate,
  TmdbSeasonDetail,
  TmdbSeasonSummary,
  TmdbShowDetail,
} from '@/features/tmdb/types';
import {
  type TmdbClientSettings,
  getTmdbSiteDefaults,
  normalizeTmdbClientSettings,
  resolveEffectiveTmdbSettings,
} from '@/lib/tmdb-preferences';

const TMDB_TIMEOUT_MS = 10_000;

export type TmdbRequestErrorCode =
  | 'network'
  | 'timeout'
  | 'bad-key'
  | 'not-found'
  | 'bad-response';

export class TmdbRequestError extends Error {
  constructor(
    public readonly code: TmdbRequestErrorCode,
    public readonly status = 0,
  ) {
    super(`tmdb: ${code}`);
    this.name = 'TmdbRequestError';
  }
}

export function describeTmdbClientError(
  error: unknown,
  fallback = 'TMDB 请求失败',
): string {
  if (error instanceof TmdbRequestError) {
    switch (error.code) {
      case 'bad-key':
        return 'TMDB API Key 无效';
      case 'timeout':
        return 'TMDB 请求超时';
      case 'network':
        // CORS 拦截与断网在 fetch 层都是 TypeError，这里统一给能指路的文案
        return '无法连接 TMDB：请检查网络或 API 地址（自定义地址需支持跨域访问）';
      case 'bad-response':
        return 'TMDB 返回了无法解析的内容';
      default:
        return 'TMDB 请求失败';
    }
  }
  return fallback;
}

export interface TmdbClientRuntimeSettings {
  apiBase: string;
  imageBase: string;
  apiKey: string;
  bearerAuth: boolean;
}

// 未启用（生效配置开关未开或没有 Key）返回 null，由调用方走 disabled 分支
export function resolveTmdbClientSettings(): TmdbClientRuntimeSettings | null {
  const settings = resolveEffectiveTmdbSettings();
  if (!settings.enabled || !settings.apiKey) {
    return null;
  }
  return toRuntimeSettings(settings);
}

function toRuntimeSettings(
  settings: TmdbClientSettings,
): TmdbClientRuntimeSettings {
  return {
    apiBase: settings.apiHost,
    imageBase: settings.imageHost,
    apiKey: settings.apiKey,
    // eyJ 开头是 v4 read access token，走 Authorization 头；否则按 v3 api_key 附在 query
    bearerAuth: settings.apiKey.startsWith('eyJ'),
  };
}

// 纯函数：拼请求 URL（language 固定 zh-CN；v3 附 api_key query，v4 不附、鉴权走头）
export function buildTmdbRequestUrl(
  settings: Pick<
    TmdbClientRuntimeSettings,
    'apiBase' | 'apiKey' | 'bearerAuth'
  >,
  path: string,
  params: Record<string, string> = {},
): string {
  const url = new URL(`${settings.apiBase}${path}`);
  url.searchParams.set('language', 'zh-CN');
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  if (!settings.bearerAuth) {
    url.searchParams.set('api_key', settings.apiKey);
  }
  return url.toString();
}

async function tmdbClientFetchJson<T>(
  settings: TmdbClientRuntimeSettings,
  path: string,
  params: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  // 手动合并外部取消（组件卸载）与超时；不用 AbortSignal.any 以兼容更早的浏览器
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);
  let response: Response;
  try {
    response = await fetch(buildTmdbRequestUrl(settings, path, params), {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(settings.bearerAuth
          ? { Authorization: `Bearer ${settings.apiKey}` }
          : {}),
      },
    });
  } catch {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    if (controller.signal.aborted) {
      throw new TmdbRequestError('timeout');
    }
    throw new TmdbRequestError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw new TmdbRequestError('bad-key', response.status);
    }
    if (response.status === 404) {
      throw new TmdbRequestError('not-found', response.status);
    }
    throw new TmdbRequestError('network', response.status);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new TmdbRequestError('bad-response');
  }
}

interface RawSearchResult {
  id?: unknown;
  name?: unknown;
  title?: unknown;
  media_type?: unknown;
  original_name?: unknown;
  original_title?: unknown;
  first_air_date?: unknown;
  release_date?: unknown;
  overview?: unknown;
  poster_path?: unknown;
  backdrop_path?: unknown;
  vote_average?: unknown;
  vote_count?: unknown;
  origin_country?: unknown;
  // 季摘要字段
  season_number?: unknown;
  air_date?: unknown;
  episode_count?: unknown;
  // 详情页字段
  status?: unknown;
  number_of_seasons?: unknown;
  number_of_episodes?: unknown;
  seasons?: unknown;
  episodes?: unknown;
  runtime?: unknown;
  genres?: unknown;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function toSearchCandidate(raw: RawSearchResult): TmdbSearchCandidate | null {
  const id = toNumber(raw.id);
  const name = typeof raw.name === 'string' ? raw.name : raw.title;
  if (!id || typeof name !== 'string' || !name) return null;
  return {
    id,
    name,
    original_name:
      (typeof raw.original_name === 'string' && raw.original_name) ||
      (typeof raw.original_title === 'string' && raw.original_title) ||
      '',
    first_air_date: toNullableString(raw.first_air_date ?? raw.release_date),
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    poster_path: toNullableString(raw.poster_path),
    vote_average: toNumber(raw.vote_average),
    vote_count: toNumber(raw.vote_count),
    origin_country: Array.isArray(raw.origin_country)
      ? raw.origin_country.filter(
          (item): item is string => typeof item === 'string',
        )
      : undefined,
  };
}

// 会话级缓存（模块 Map，页面生命周期）：返回上一页/重开详情页时不再重复打 TMDB。
// 只缓存成功结果；无 TTL，数据变化靠刷新页面。
const SESSION_CACHE_MAX = 128;
const sessionCache = new Map<string, unknown>();

function readSessionCache<T>(key: string): T | undefined {
  return sessionCache.get(key) as T | undefined;
}

function writeSessionCache(key: string, value: unknown) {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) {
      sessionCache.delete(oldest);
    }
  }
  sessionCache.set(key, value);
}

export async function searchTmdb(
  settings: TmdbClientRuntimeSettings,
  mediaType: 'tv' | 'movie',
  query: string,
  signal?: AbortSignal,
): Promise<TmdbSearchCandidate[]> {
  const data = await tmdbClientFetchJson<{ results?: unknown }>(
    settings,
    '/search/' + mediaType,
    {
      query,
      include_adult: 'false',
      page: '1',
    },
    signal,
  );
  if (!Array.isArray(data?.results)) {
    throw new TmdbRequestError('bad-response');
  }
  return data.results
    .map((item) => toSearchCandidate(item as RawSearchResult))
    .filter((item): item is TmdbSearchCandidate => item !== null);
}

export interface TmdbMultiSearchItem extends TmdbSearchCandidate {
  mediaType: TmdbMediaType;
}

function toMultiSearchItem(raw: RawSearchResult): TmdbMultiSearchItem | null {
  // web 无演员页，person 结果直接过滤
  if (raw.media_type !== 'tv' && raw.media_type !== 'movie') {
    return null;
  }
  const candidate = toSearchCandidate(raw);
  if (!candidate) return null;
  return { ...candidate, mediaType: raw.media_type };
}

// 搜索页整页结果用：/search/multi 一次拿 tv+movie（对齐手机版搜索页）。强制走网络、不进会话缓存。
export async function searchTmdbMulti(
  settings: TmdbClientRuntimeSettings,
  query: string,
  signal?: AbortSignal,
): Promise<TmdbMultiSearchItem[]> {
  const data = await tmdbClientFetchJson<{ results?: unknown }>(
    settings,
    '/search/multi',
    {
      query,
      include_adult: 'false',
      page: '1',
    },
    signal,
  );
  if (!Array.isArray(data?.results)) {
    throw new TmdbRequestError('bad-response');
  }
  return data.results
    .map((item) => toMultiSearchItem(item as RawSearchResult))
    .filter((item): item is TmdbMultiSearchItem => item !== null);
}

// 对齐手机版 fetchSearchMultiSmart：原词空结果时剥季标记再搜一轮（「XX 第二季」→「XX」）
export async function searchTmdbMultiSmart(
  settings: TmdbClientRuntimeSettings,
  query: string,
  signal?: AbortSignal,
): Promise<{ items: TmdbMultiSearchItem[]; strippedQuery: string }> {
  const items = await searchTmdbMulti(settings, query, signal);
  if (items.length > 0) {
    return { items, strippedQuery: '' };
  }
  const stripped = stripSeasonMarker(query).trim();
  if (!stripped || stripped === query) {
    return { items, strippedQuery: '' };
  }
  const retry = await searchTmdbMulti(settings, stripped, signal);
  return { items: retry, strippedQuery: retry.length > 0 ? stripped : '' };
}

function toSeasonSummary(raw: RawSearchResult): TmdbSeasonSummary | null {
  const id = toNumber(raw.id);
  const seasonNumber = toNumber(raw.season_number, -1);
  if (!id || seasonNumber < 0) return null;
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : '',
    season_number: seasonNumber,
    air_date: toNullableString(raw.air_date),
    episode_count: toNumber(raw.episode_count),
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    poster_path: toNullableString(raw.poster_path),
  };
}

export async function fetchTmdbShowDetail(
  settings: TmdbClientRuntimeSettings,
  id: number,
  signal?: AbortSignal,
): Promise<TmdbShowDetail> {
  const cacheKey = `tv:${id}`;
  const cached = readSessionCache<TmdbShowDetail>(cacheKey);
  if (cached) return cached;
  const raw = await tmdbClientFetchJson<Record<string, unknown>>(
    settings,
    `/tv/${id}`,
    {},
    signal,
  );
  const seasons = Array.isArray(raw.seasons)
    ? raw.seasons
        .map((item) => toSeasonSummary(item as RawSearchResult))
        .filter((item): item is TmdbSeasonSummary => item !== null)
    : [];
  const detail: TmdbShowDetail = {
    id: toNumber(raw.id, id),
    name: typeof raw.name === 'string' ? raw.name : '',
    original_name:
      typeof raw.original_name === 'string' ? raw.original_name : '',
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    first_air_date: toNullableString(raw.first_air_date),
    poster_path: toNullableString(raw.poster_path),
    backdrop_path: toNullableString(raw.backdrop_path),
    vote_average: toNumber(raw.vote_average),
    vote_count: toNumber(raw.vote_count),
    genres: Array.isArray(raw.genres)
      ? raw.genres
          .map((genre) =>
            genre &&
            typeof genre === 'object' &&
            typeof (genre as { name?: unknown }).name === 'string'
              ? (genre as { name: string }).name
              : '',
          )
          .filter(Boolean)
      : [],
    status: typeof raw.status === 'string' ? raw.status : '',
    number_of_seasons: toNumber(raw.number_of_seasons),
    number_of_episodes: toNumber(raw.number_of_episodes),
    seasons,
  };
  writeSessionCache(cacheKey, detail);
  return detail;
}

export async function fetchTmdbSeasonDetail(
  settings: TmdbClientRuntimeSettings,
  showId: number,
  seasonNumber: number,
  signal?: AbortSignal,
): Promise<TmdbSeasonDetail> {
  const cacheKey = `season:${showId}:${seasonNumber}`;
  const cached = readSessionCache<TmdbSeasonDetail>(cacheKey);
  if (cached) return cached;
  const raw = await tmdbClientFetchJson<Record<string, unknown>>(
    settings,
    `/tv/${showId}/season/${seasonNumber}`,
    {},
    signal,
  );
  const episodes = Array.isArray(raw.episodes)
    ? raw.episodes
        .map((item) => {
          const episode = item as Record<string, unknown>;
          const episodeId = toNumber(episode.id);
          const episodeNumber = toNumber(episode.episode_number, -1);
          if (!episodeId || episodeNumber < 0) return null;
          return {
            id: episodeId,
            name: typeof episode.name === 'string' ? episode.name : '',
            overview:
              typeof episode.overview === 'string' ? episode.overview : '',
            episode_number: episodeNumber,
            season_number: toNumber(episode.season_number, seasonNumber),
            air_date: toNullableString(episode.air_date),
            still_path: toNullableString(episode.still_path),
            runtime:
              typeof episode.runtime === 'number' ? episode.runtime : null,
            vote_average: toNumber(episode.vote_average),
          };
        })
        .filter(
          (item): item is TmdbSeasonDetail['episodes'][number] => item !== null,
        )
    : [];
  const detail: TmdbSeasonDetail = {
    showId,
    seasonNumber,
    name: typeof raw.name === 'string' ? raw.name : '',
    airDate: toNullableString(raw.air_date),
    episodes,
  };
  writeSessionCache(cacheKey, detail);
  return detail;
}

export async function fetchTmdbMovieDetail(
  settings: TmdbClientRuntimeSettings,
  id: number,
  signal?: AbortSignal,
): Promise<TmdbMovieDetail> {
  const cacheKey = `movie:${id}`;
  const cached = readSessionCache<TmdbMovieDetail>(cacheKey);
  if (cached) return cached;
  const raw = await tmdbClientFetchJson<Record<string, unknown>>(
    settings,
    `/movie/${id}`,
    {},
    signal,
  );
  const detail: TmdbMovieDetail = {
    id: toNumber(raw.id, id),
    title: typeof raw.title === 'string' ? raw.title : '',
    original_title:
      typeof raw.original_title === 'string' ? raw.original_title : '',
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    release_date: toNullableString(raw.release_date),
    poster_path: toNullableString(raw.poster_path),
    backdrop_path: toNullableString(raw.backdrop_path),
    vote_average: toNumber(raw.vote_average),
    vote_count: toNumber(raw.vote_count),
    genres: Array.isArray(raw.genres)
      ? raw.genres
          .map((genre) =>
            genre &&
            typeof genre === 'object' &&
            typeof (genre as { name?: unknown }).name === 'string'
              ? (genre as { name: string }).name
              : '',
          )
          .filter(Boolean)
      : [],
    runtime: typeof raw.runtime === 'number' ? raw.runtime : null,
  };
  writeSessionCache(cacheKey, detail);
  return detail;
}

// 豆瓣条目 → TMDB 最佳匹配：两轮搜索（先按传入类型，不过线再用另一类型兜底——
// 同名电影/剧集录错型），打分与阈值逻辑与服务端版一致（resolve.ts 纯函数）。
async function resolveBestMatchUncached(
  settings: TmdbClientRuntimeSettings,
  title: string,
  year: string,
  preferredType: TmdbMediaType,
  signal?: AbortSignal,
): Promise<TmdbResolveResponse> {
  const isTv = preferredType !== 'movie';
  const stripped = isTv ? stripSeasonMarker(title) : title;
  const queries = buildResolveQueries(title, stripped);

  let best: { match: TmdbResolveMatch; asTv: boolean } | null = null;
  for (let round = 0; round < 2 && !best; round += 1) {
    const asTv = round === 0 ? isTv : !isTv;
    const mediaType: TmdbMediaType = asTv ? 'tv' : 'movie';
    for (const query of queries) {
      const candidates = await searchTmdb(settings, mediaType, query, signal);
      for (const candidate of candidates) {
        const score = scoreTmdbCandidate(candidate, {
          title,
          cleanedTitle: stripped,
          year,
        });
        if (!isTmdbMatchScore(score)) continue;
        if (!best || score > best.match.score) {
          best = {
            asTv,
            match: {
              mediaType,
              id: candidate.id,
              name: candidate.name,
              originalName: candidate.original_name,
              firstAirDate: candidate.first_air_date || '',
              overview: candidate.overview,
              posterPath: candidate.poster_path,
              score,
            },
          };
        }
      }
    }
  }

  return {
    status: best ? 'ok' : 'no-match',
    match: best?.match ?? null,
    strippedTitle: stripped,
  };
}

// 未启用返回 disabled；网络/Key 错误抛 TmdbRequestError，调用方用 describeTmdbClientError 转文案
export async function resolveBestTmdbMatch(
  title: string,
  year: string,
  preferredType: TmdbMediaType,
  signal?: AbortSignal,
): Promise<TmdbResolveResponse> {
  const settings = resolveTmdbClientSettings();
  if (!settings) {
    return { status: 'disabled', match: null, strippedTitle: '' };
  }
  const cacheKey = `resolve:${preferredType}:${title}:${year}`;
  const cached = readSessionCache<TmdbResolveResponse>(cacheKey);
  if (cached) return cached;
  const result = await resolveBestMatchUncached(
    settings,
    title,
    year,
    preferredType,
    signal,
  );
  if (result.status === 'ok' || result.status === 'no-match') {
    writeSessionCache(cacheKey, result);
  }
  return result;
}

// 设置面板「测试」用：拿面板当前草稿合并站点默认后打 /configuration，
// 验证的正是「留空继承默认」时实际会用的地址 + Key 组合
export async function testTmdbConnection(
  settings: Partial<Pick<TmdbClientSettings, 'apiHost' | 'apiKey'>>,
): Promise<void> {
  const site = getTmdbSiteDefaults();
  const normalized = normalizeTmdbClientSettings({
    ...settings,
    enabled: true,
    apiHost: settings?.apiHost || site.apiHost,
    apiKey: settings?.apiKey || site.apiKey,
  });
  if (!normalized.apiKey) {
    throw new TmdbRequestError('bad-key');
  }
  await tmdbClientFetchJson(toRuntimeSettings(normalized), '/configuration');
}
