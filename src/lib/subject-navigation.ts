import { isTmdbClientEnabled } from '@/lib/tmdb-preferences';

// TMDB 详情页入口：生效配置（本地设置 + 站点 env 默认）开启且配了 Key 时，
// 豆瓣海报类点击与搜索 TMDB 结果点击先进 /subject 选季选集。
// 判定同步读 localStorage + window.RUNTIME_CONFIG，点击时实时生效；未启用回退旧的直接搜索播放链路。
export function isTmdbSubjectEntryEnabled(): boolean {
  return isTmdbClientEnabled();
}

export function buildSubjectPageUrl({
  title,
  year,
  type,
  doubanId,
  poster,
  // 搜索结果直进：已拿到 TMDB id 时跳过标题匹配，直接拉该条目详情
  tmdbId,
  // 关键词季标记提示（如「XX 第二季」→ 2），用于初始季推断
  season,
}: {
  title: string;
  year?: string;
  type?: string;
  doubanId?: number | string;
  poster?: string;
  tmdbId?: number;
  season?: number;
}): string {
  const params = new URLSearchParams({ title: title.trim() });
  if (year) params.set('year', year);
  if (type) params.set('stype', type);
  if (doubanId) params.set('doubanId', String(doubanId));
  if (poster) params.set('poster', poster);
  if (tmdbId) params.set('tmdbId', String(tmdbId));
  if (season && season > 0) params.set('season', String(season));
  return `/subject?${params.toString()}`;
}
