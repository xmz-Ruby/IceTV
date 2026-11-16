import { getConfigForRead } from '@/lib/config';
import type { DoubanFetchInit } from '@/lib/douban';
import { normalizeSiteDoubanServerUpstream } from '@/lib/douban-options';
import { DOUBAN_FRODO_HEADERS } from '@/lib/douban-upstream-url';

// 服务端豆瓣上游选择：`upstream` query 参数（web|frodo，用户显式指定的「代理·frodo」通道优先）
// 高于站长配置；站长 auto = 旧豆瓣优先、失败转 frodo（回退由调用方实现）。
// frodo 上游只覆盖分类（recent_hot）与筛选（recommend）请求，
// 标签列表（search_subjects）无 frodo 等价端点，不走本选择。
export type DoubanUpstreamMode = 'web' | 'frodo' | 'auto';

export async function resolveDoubanUpstreamMode(
  upstreamParam: string | null,
): Promise<DoubanUpstreamMode> {
  if (upstreamParam === 'web' || upstreamParam === 'frodo') {
    return upstreamParam;
  }
  const config = await getConfigForRead();
  return normalizeSiteDoubanServerUpstream(
    config.SiteConfig.DoubanServerUpstream,
  );
}

// frodo 校验小程序身份（微信 UA + servicewechat Referer，实测 Origin 头无影响）
export function doubanUpstreamFetchInit(
  mode: 'web' | 'frodo',
): DoubanFetchInit {
  return mode === 'frodo' ? { headers: DOUBAN_FRODO_HEADERS } : {};
}
