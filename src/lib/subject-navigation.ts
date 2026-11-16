import { getRuntimeConfig } from '@/lib/runtime-config';

// TMDB 详情页入口：站点开启 TMDB 且配置了 Key 时，豆瓣海报类点击先进 /subject 选季选集。
// 判断只读内联注入的 window.RUNTIME_CONFIG，未就绪（undefined）按未开启回退旧链路。
export function isTmdbSubjectEntryEnabled(): boolean {
  return getRuntimeConfig()?.TMDB_ENABLED === true;
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
