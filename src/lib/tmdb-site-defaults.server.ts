import {
  DEFAULT_TMDB_API_HOST,
  DEFAULT_TMDB_IMAGE_HOST,
} from '@/lib/tmdb-defaults';

// 站点级 TMDB 默认配置：只来自环境变量，不落库、无后台界面。
// Key 与 host 会随 RUNTIME_CONFIG / server-config 下发给所有访问者（含游客）——
// TMDB 本就是浏览器直连，这属于设计前提，不是泄露；用户本地设置可逐字段覆盖。
export interface TmdbSiteDefaults {
  TMDB_DEFAULT_ENABLED: boolean;
  TMDB_DEFAULT_API_HOST: string;
  TMDB_DEFAULT_API_KEY: string;
  TMDB_DEFAULT_IMAGE_HOST: string;
}

function normalizeHost(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function getTmdbSiteDefaults(): TmdbSiteDefaults {
  const apiKey = (process.env.TMDB_DEFAULT_API_KEY || '').trim();
  const enabledFlag = (process.env.TMDB_DEFAULT_ENABLED || '')
    .trim()
    .toLowerCase();
  return {
    // 未显式配置时：给了 Key 就默认开，不给就保持关闭
    TMDB_DEFAULT_ENABLED:
      enabledFlag === 'true'
        ? true
        : enabledFlag === 'false'
          ? false
          : Boolean(apiKey),
    TMDB_DEFAULT_API_HOST: normalizeHost(
      process.env.TMDB_DEFAULT_API_HOST,
      DEFAULT_TMDB_API_HOST,
    ),
    TMDB_DEFAULT_API_KEY: apiKey,
    TMDB_DEFAULT_IMAGE_HOST: normalizeHost(
      process.env.TMDB_DEFAULT_IMAGE_HOST,
      DEFAULT_TMDB_IMAGE_HOST,
    ),
  };
}
