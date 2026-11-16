// 豆瓣上游地址的唯一构建处：客户端直连 / 镜像与服务端路由共用，参数统一经 URLSearchParams 编码
const DOUBAN_HOSTS = {
  douban: { m: 'https://m.douban.com', movie: 'https://movie.douban.com' },
  'cmliussss-tencent': {
    m: 'https://m.douban.cmliussss.net',
    movie: 'https://movie.douban.cmliussss.net',
  },
  'cmliussss-ali': {
    m: 'https://m.douban.cmliussss.com',
    movie: 'https://movie.douban.cmliussss.com',
  },
  // frodo 是豆瓣 App/小程序接口（与 AndroidCatVodSpider 的豆瓣爬虫同一套公开参数），
  // 响应与 web rexxar 同形。frodo 校验 key 与客户端身份配对（微信 UA + servicewechat Referer），
  // 浏览器禁设这两个头，只能由服务端请求；host 的 m 已含 /api/v2 前缀（web 端是 /rexxar/api/v2）
  frodo: {
    m: 'https://frodo.douban.com/api/v2',
    movie: 'https://frodo.douban.com/api/v2',
  },
} as const;

// 公开小程序 key（各开源豆瓣爬虫通用），配 DOUBAN_FRODO_HEADERS 使用
export const DOUBAN_FRODO_APIKEY = '0ac44ae016490db2204ce0a042db2916';
export const DOUBAN_FRODO_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36 MicroMessenger/7.0.9.501 NetType/WIFI MiniProgramEnv/Windows WindowsWechat',
  Referer: 'https://servicewechat.com/wx2f9b06c1de1ccfca/84/page-frame.html',
  Accept: 'application/json, text/plain, */*',
};

export type DoubanUpstreamHost = keyof typeof DOUBAN_HOSTS;

export interface DoubanRecentHotQuery {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  start: number;
  limit: number;
}

export function buildDoubanRecentHotUrl(
  { kind, category, type, start, limit }: DoubanRecentHotQuery,
  host: DoubanUpstreamHost = 'douban',
): string {
  const params = new URLSearchParams({
    start: String(start),
    limit: String(limit),
    category,
    type,
  });
  if (host === 'frodo') params.set('apikey', DOUBAN_FRODO_APIKEY);
  // web 系走 m.douban.com 的 rexxar 网关；frodo host 的 m 已含 /api/v2 前缀
  const rexxarPrefix = host === 'frodo' ? '' : '/rexxar/api/v2';
  return `${DOUBAN_HOSTS[host].m}${rexxarPrefix}/subject/recent_hot/${kind}?${params}`;
}

export interface DoubanSearchSubjectsQuery {
  type: 'tv' | 'movie';
  tag: string;
  start: number;
  limit: number;
}

export function buildDoubanSearchSubjectsUrl(
  { type, tag, start, limit }: DoubanSearchSubjectsQuery,
  host: DoubanUpstreamHost = 'douban',
): string {
  const params = new URLSearchParams({
    type,
    tag,
    sort: 'recommend',
    page_limit: String(limit),
    page_start: String(start),
  });
  return `${DOUBAN_HOSTS[host].movie}/j/search_subjects?${params}`;
}

export interface DoubanRecommendQuery {
  kind: 'tv' | 'movie';
  start: number;
  limit: number;
  category?: string | null;
  format?: string | null;
  label?: string | null;
  region?: string | null;
  year?: string | null;
  platform?: string | null;
  sort?: string | null;
}

// 筛选项的「全部」/ 默认排序在界面上有显式取值，上游要求留空
function filterValue(value: string | null | undefined, anyValue = 'all') {
  return !value || value === anyValue ? '' : value;
}

export function buildDoubanRecommendUrl(
  query: DoubanRecommendQuery,
  host: DoubanUpstreamHost = 'douban',
): string {
  const category = filterValue(query.category);
  const format = filterValue(query.format);
  const label = filterValue(query.label);
  const region = filterValue(query.region);
  const year = filterValue(query.year);
  const platform = filterValue(query.platform);
  const sort = filterValue(query.sort, 'T');

  const selectedCategories: Record<string, string> = { 类型: category };
  if (format) selectedCategories['形式'] = format;
  if (region) selectedCategories['地区'] = region;

  const tags = [category || format, label, region, year, platform].filter(
    Boolean,
  );

  const params = new URLSearchParams({
    refresh: '0',
    start: String(query.start),
    count: String(query.limit),
    selected_categories: JSON.stringify(selectedCategories),
    uncollect: 'false',
    score_range: '0,10',
    tags: tags.join(','),
  });
  if (sort) params.set('sort', sort);
  if (host === 'frodo') params.set('apikey', DOUBAN_FRODO_APIKEY);
  // web 系走 m.douban.com 的 rexxar 网关；frodo host 的 m 已含 /api/v2 前缀
  const rexxarPrefix = host === 'frodo' ? '' : '/rexxar/api/v2';
  return `${DOUBAN_HOSTS[host].m}${rexxarPrefix}/${query.kind}/recommend?${params}`;
}
