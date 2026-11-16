import {
  type DoubanImageProxyType,
  type DoubanProxyType,
  DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
  DEFAULT_DOUBAN_PROXY_TYPE,
} from '@/lib/douban-source';

export const doubanDataSourceOptions: { value: string; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'direct', label: '直连（浏览器请求，受限自动回退）' },
  { value: 'server', label: '代理（服务器请求）' },
  { value: 'server-frodo', label: '代理（服务器·frodo）' },
  { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
  {
    value: 'cmliussss-cdn-tencent',
    label: '豆瓣 CDN By CMLiussss（腾讯云）',
  },
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
  { value: 'custom', label: '自定义代理' },
];

export const siteDoubanDataSourceOptions = doubanDataSourceOptions.filter(
  (option) => option.value !== 'custom',
);

export const doubanImageProxyTypeOptions: { value: string; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'direct', label: '直连（浏览器请求）' },
  { value: 'server', label: '代理（服务器请求）' },
  {
    value: 'cmliussss-cdn-tencent',
    label: '豆瓣 CDN By CMLiussss（腾讯云）',
  },
  { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
  { value: 'custom', label: '自定义代理' },
];

export const siteDoubanImageProxyTypeOptions =
  doubanImageProxyTypeOptions.filter((option) => option.value !== 'custom');

export function normalizeSiteDoubanProxyType(value: unknown): DoubanProxyType {
  return siteDoubanDataSourceOptions.some((option) => option.value === value)
    ? (value as DoubanProxyType)
    : DEFAULT_DOUBAN_PROXY_TYPE;
}

export function normalizeSiteDoubanImageProxyType(
  value: unknown,
): DoubanImageProxyType {
  return siteDoubanImageProxyTypeOptions.some(
    (option) => option.value === value,
  )
    ? (value as DoubanImageProxyType)
    : DEFAULT_DOUBAN_IMAGE_PROXY_TYPE;
}

// 服务端豆瓣上游策略：影响「代理（服务器请求）」通道与自动链的服务端兜底。
// frodo 上游只覆盖分类（recent_hot）与筛选（recommend）两类请求，
// 标签列表（search_subjects）无 frodo 等价端点，始终走旧豆瓣网页接口。
export type DoubanServerUpstream = 'auto' | 'web' | 'frodo';
export const DEFAULT_DOUBAN_SERVER_UPSTREAM: DoubanServerUpstream = 'auto';
export const doubanServerUpstreamOptions: { value: string; label: string }[] = [
  { value: 'auto', label: '自动（旧豆瓣优先，失败转 frodo）' },
  { value: 'web', label: '旧豆瓣（网页接口）' },
  { value: 'frodo', label: 'frodo（App 接口）' },
];

export function normalizeSiteDoubanServerUpstream(
  value: unknown,
): DoubanServerUpstream {
  return doubanServerUpstreamOptions.some((option) => option.value === value)
    ? (value as DoubanServerUpstream)
    : DEFAULT_DOUBAN_SERVER_UPSTREAM;
}

export function getThanksInfo(
  dataSource: string,
): { text: string; url: string } | null {
  switch (dataSource) {
    case 'cors-proxy-zwei':
      return {
        text: 'Thanks to @Zwei',
        url: 'https://github.com/bestzwei',
      };
    case 'cmliussss-cdn-tencent':
    case 'cmliussss-cdn-ali':
      return {
        text: 'Thanks to @CMLiussss',
        url: 'https://github.com/cmliu',
      };
    default:
      return null;
  }
}
