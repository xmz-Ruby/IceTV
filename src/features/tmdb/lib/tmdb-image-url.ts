// TMDB 图片统一走本站代理（/api/tmdb-image），客户端不直连 image.tmdb.org
export type TmdbImageSize =
  | 'w185'
  | 'w300'
  | 'w342'
  | 'w500'
  | 'w780'
  | 'w1280'
  | 'original';

export function tmdbImageUrl(
  path: string | null | undefined,
  size: TmdbImageSize,
): string {
  if (!path) return '';
  return `/api/tmdb-image/${size}${path.startsWith('/') ? path : `/${path}`}`;
}
