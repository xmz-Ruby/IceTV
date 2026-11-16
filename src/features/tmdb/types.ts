// TMDB 裁剪类型：只保留详情页与匹配链路需要的字段
export type TmdbMediaType = 'tv' | 'movie';

export interface TmdbSearchCandidate {
  id: number;
  name: string;
  original_name: string;
  first_air_date: string | null;
  overview: string;
  poster_path: string | null;
  vote_average: number;
  vote_count: number;
  origin_country?: string[];
}

export interface TmdbSeasonSummary {
  id: number;
  name: string;
  season_number: number;
  air_date: string | null;
  episode_count: number;
  overview: string;
  poster_path: string | null;
}

export interface TmdbShowDetail {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  genres: string[];
  status: string;
  number_of_seasons: number;
  number_of_episodes: number;
  seasons: TmdbSeasonSummary[];
}

export interface TmdbEpisode {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  air_date: string | null;
  still_path: string | null;
  runtime: number | null;
  vote_average: number;
}

export interface TmdbSeasonDetail {
  showId: number;
  seasonNumber: number;
  name: string;
  airDate: string | null;
  episodes: TmdbEpisode[];
}

export interface TmdbMovieDetail {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  genres: string[];
  runtime: number | null;
}

export interface TmdbResolveMatch {
  mediaType: TmdbMediaType;
  id: number;
  name: string;
  originalName: string;
  firstAirDate: string;
  overview: string;
  posterPath: string | null;
  score: number;
}

export type TmdbResolveStatus = 'ok' | 'disabled' | 'no-match' | 'error';

export interface TmdbResolveResponse {
  status: TmdbResolveStatus;
  match: TmdbResolveMatch | null;
  strippedTitle: string;
  error?: string;
}
