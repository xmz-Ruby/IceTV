import { isTmdbClientEnabled } from '@/lib/tmdb-preferences';

// TMDB 详情页入口：用户在本地设置中开启 TMDB 且填了 Key 时，豆瓣海报类点击先进 /subject 选季选集。
// 判定同步读 localStorage，点击时实时生效；未启用回退旧的直接搜索播放链路。
export function isTmdbSubjectEntryEnabled(): boolean {
  return isTmdbClientEnabled();
}

export function buildSubjectPageUrl({
  title,
  year,
  type,
  doubanId,
  poster,
}: {
  title: string;
  year?: string;
  type?: string;
  doubanId?: number | string;
  poster?: string;
}): string {
  const params = new URLSearchParams({ title: title.trim() });
  if (year) params.set('year', year);
  if (type) params.set('stype', type);
  if (doubanId) params.set('doubanId', String(doubanId));
  if (poster) params.set('poster', poster);
  return `/subject?${params.toString()}`;
}
