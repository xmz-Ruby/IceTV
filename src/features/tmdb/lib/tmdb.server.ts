import 'server-only';

import {
  type TmdbMovieDetail,
  type TmdbSearchCandidate,
  type TmdbSeasonDetail,
  type TmdbSeasonSummary,
  type TmdbShowDetail,
} from '@/features/tmdb/types';
import { getConfigForRead } from '@/lib/config';
import {
  readJsonLimited,
  UPSTREAM_METADATA_MAX_BYTES,
} from '@/lib/proxy-response-limits';
import { fetchUpstream } from '@/lib/upstream-fetch.server';

const TMDB_TIMEOUT_MS = 10_000;

export type TmdbRequestErrorCode =
  | 'disabled'
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

export interface TmdbRuntimeSettings {
  enabled: boolean;
  apiBase: string;
  imageBase: string;
  apiKey: string;
  bearerAuth: boolean;
}

export async function resolveTmdbRuntimeSettings(): Promise<TmdbRuntimeSettings> {
  const config = await getConfigForRead();
  const settings = config.TmdbConfig;
  const apiKey = (settings?.ApiKey || '').trim();
  return {
    enabled: settings?.Enabled === true && !!apiKey,
    apiBase: settings?.ApiHost || 'https://api.themoviedb.org/3',
    imageBase: settings?.ImageHost || 'https://image.tmdb.org/t/p',
    apiKey,
    // eyJ 开头是 v4 read access token，走 Authorization 头；否则按 v3 api_key 附在 query
    bearerAuth: apiKey.startsWith('eyJ'),
  };
}

export async function tmdbFetchJson<T>(
  settings: TmdbRuntimeSettings,
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  if (!settings.enabled) {
    throw new TmdbRequestError('disabled');
  }

  const url = new URL(`${settings.apiBase}${path}`);
  url.searchParams.set('language', 'zh-CN');
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  if (!settings.bearerAuth) {
    url.searchParams.set('api_key', settings.apiKey);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchUpstream(url.toString(), {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(settings.bearerAuth
          ? { Authorization: `Bearer ${settings.apiKey}` }
          : {}),
      },
    });
  } catch {
    if (controller.signal.aborted) {
      throw new TmdbRequestError('timeout');
    }
    throw new TmdbRequestError('network');
  } finally {
    clearTimeout(timer);
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
    return await readJsonLimited<T>(response, UPSTREAM_METADATA_MAX_BYTES);
  } catch {
    throw new TmdbRequestError('bad-response');
  }
}

interface RawSearchResult {
  id?: unknown;
  name?: unknown;
  title?: unknown;
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

export async function searchTmdb(
  settings: TmdbRuntimeSettings,
  mediaType: 'tv' | 'movie',
  query: string,
): Promise<TmdbSearchCandidate[]> {
  const data = await tmdbFetchJson<{ results?: unknown }>(
    settings,
    '/search/' + mediaType,
    {
      query,
      include_adult: 'false',
      page: '1',
    },
  );
  if (!Array.isArray(data?.results)) {
    throw new TmdbRequestError('bad-response');
  }
  return data.results
    .map((item) => toSearchCandidate(item as RawSearchResult))
    .filter((item): item is TmdbSearchCandidate => item !== null);
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
  settings: TmdbRuntimeSettings,
  id: number,
): Promise<TmdbShowDetail> {
  const raw = await tmdbFetchJson<Record<string, unknown>>(settings, `/tv/${id}`);
  const seasons = Array.isArray(raw.seasons)
    ? raw.seasons
        .map((item) => toSeasonSummary(item as RawSearchResult))
        .filter((item): item is TmdbSeasonSummary => item !== null)
    : [];
  return {
    id: toNumber(raw.id, id),
    name: typeof raw.name === 'string' ? raw.name : '',
    original_name: typeof raw.original_name === 'string' ? raw.original_name : '',
    overview: typeof raw.overview === 'string' ? raw.overview : '',
    first_air_date: toNullableString(raw.first_air_date),
    poster_path: toNullableString(raw.poster_path),
    backdrop_path: toNullableString(raw.backdrop_path),
    vote_average: toNumber(raw.vote_average),
    vote_count: toNumber(raw.vote_count),
    genres: Array.isArray(raw.genres)
      ? raw.genres
          .map((genre) =>
            genre && typeof genre === 'object' && typeof (genre as { name?: unknown }).name === 'string'
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
}

export async function fetchTmdbSeasonDetail(
  settings: TmdbRuntimeSettings,
  showId: number,
  seasonNumber: number,
): Promise<TmdbSeasonDetail> {
  const raw = await tmdbFetchJson<Record<string, unknown>>(
    settings,
    `/tv/${showId}/season/${seasonNumber}`,
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
            overview: typeof episode.overview === 'string' ? episode.overview : '',
            episode_number: episodeNumber,
            season_number: toNumber(episode.season_number, seasonNumber),
            air_date: toNullableString(episode.air_date),
            still_path: toNullableString(episode.still_path),
            runtime: typeof episode.runtime === 'number' ? episode.runtime : null,
            vote_average: toNumber(episode.vote_average),
          };
        })
        .filter(
          (item): item is TmdbSeasonDetail['episodes'][number] => item !== null,
        )
    : [];
  return {
    showId,
    seasonNumber,
    name: typeof raw.name === 'string' ? raw.name : '',
    airDate: toNullableString(raw.air_date),
    episodes,
  };
}

export async function fetchTmdbMovieDetail(
  settings: TmdbRuntimeSettings,
  id: number,
): Promise<TmdbMovieDetail> {
  const raw = await tmdbFetchJson<Record<string, unknown>>(settings, `/movie/${id}`);
  return {
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
            genre && typeof genre === 'object' && typeof (genre as { name?: unknown }).name === 'string'
              ? (genre as { name: string }).name
              : '',
          )
          .filter(Boolean)
      : [],
    runtime: typeof raw.runtime === 'number' ? raw.runtime : null,
  };
}
