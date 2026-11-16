import { resolveEffectiveTmdbSettings } from '@/lib/tmdb-preferences';

// TMDB 图片由浏览器直连图片 host（<img> 加载不受 CORS 限制），host 取生效配置
// （本地设置空串继承站点 env 默认）。服务端渲染时读不到 localStorage/runtime，
// 回落内置默认 host；该页图片都在客户端数据加载后渲染。
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
  const base = resolveEffectiveTmdbSettings().imageHost;
  return `${base}/${size}${path.startsWith('/') ? path : `/${path}`}`;
}
