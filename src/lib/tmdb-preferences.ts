import {
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';
import { getRuntimeConfig } from '@/lib/runtime-config';
import {
  DEFAULT_TMDB_API_HOST,
  DEFAULT_TMDB_IMAGE_HOST,
} from '@/lib/tmdb-defaults';

export {
  DEFAULT_TMDB_API_HOST,
  DEFAULT_TMDB_IMAGE_HOST,
} from '@/lib/tmdb-defaults';

export const TMDB_SETTINGS_STORAGE_KEY = 'tmdbSettings';

export interface TmdbClientSettings {
  enabled: boolean;
  apiHost: string;
  apiKey: string;
  imageHost: string;
}

// 无站点级 env 时的内置默认：关闭 + 官方地址（DEFAULT_TMDB_SETTINGS 的 host
// 不再随存储固化，见 normalizeHost —— 空串表示跟随站点默认）
export const DEFAULT_TMDB_SETTINGS: TmdbClientSettings = {
  enabled: false,
  apiHost: DEFAULT_TMDB_API_HOST,
  apiKey: '',
  imageHost: DEFAULT_TMDB_IMAGE_HOST,
};

// host 留空或非法 → 空串：语义是「未设置，跟随站点默认」，由 resolveEffectiveTmdbSettings 兜底
function normalizeHost(value: string | undefined): string {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return '';
  }
  return trimmed;
}

export function normalizeTmdbClientSettings(
  settings: Partial<TmdbClientSettings> | undefined | null,
): TmdbClientSettings {
  return {
    enabled: settings?.enabled === true,
    apiHost: normalizeHost(settings?.apiHost),
    apiKey: (settings?.apiKey || '').trim(),
    imageHost: normalizeHost(settings?.imageHost),
  };
}

// 站点级默认（env 提供，经 RUNTIME_CONFIG 下发）。无配置时回落内置默认（关闭 + 官方地址）。
export function getTmdbSiteDefaults(): TmdbClientSettings {
  const runtime = getRuntimeConfig();
  return {
    enabled: runtime?.TMDB_DEFAULT_ENABLED ?? DEFAULT_TMDB_SETTINGS.enabled,
    apiHost: runtime?.TMDB_DEFAULT_API_HOST || DEFAULT_TMDB_API_HOST,
    apiKey: runtime?.TMDB_DEFAULT_API_KEY || '',
    imageHost: runtime?.TMDB_DEFAULT_IMAGE_HOST || DEFAULT_TMDB_IMAGE_HOST,
  };
}

// 实际生效配置：本地存储逐字段覆盖站点默认。
// - 未存过本地设置 → 全用站点默认
// - 存过 → host/Key/图片地址空串继承站点默认；enabled 只认用户显式布尔
//   （本地 JSON 没有 enabled 字段时也继承站点默认）
export function resolveEffectiveTmdbSettings(): TmdbClientSettings {
  const site = getTmdbSiteDefaults();
  const stored = readStoredSettings();
  if (!stored) {
    return site;
  }
  const normalized = normalizeTmdbClientSettings(stored);
  return {
    enabled: stored.enabled === undefined ? site.enabled : normalized.enabled,
    apiHost: normalized.apiHost || site.apiHost,
    apiKey: normalized.apiKey || site.apiKey,
    imageHost: normalized.imageHost || site.imageHost,
  };
}

function readStoredSettings(): Partial<TmdbClientSettings> | null {
  const raw = readStorage(TMDB_SETTINGS_STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed as Partial<TmdbClientSettings>;
  } catch {
    return null;
  }
}

// 存储侧视图：host 空串 = 跟随站点默认（设置面板编辑用）
export function readTmdbSettings(): TmdbClientSettings {
  return normalizeTmdbClientSettings(readStoredSettings());
}

// 存归一化后的值（host 去尾斜杠、非法置空、Key 去空白），读侧不再二次判定
export function writeTmdbSettings(
  settings: Partial<TmdbClientSettings> | undefined | null,
): boolean {
  return writeStorage(
    TMDB_SETTINGS_STORAGE_KEY,
    JSON.stringify(normalizeTmdbClientSettings(settings)),
  );
}

export function resetTmdbSettings() {
  return removeStorage(TMDB_SETTINGS_STORAGE_KEY);
}

// 对外可用的判定：生效配置开关打开且配了 Key（本地或站点默认任一来源）
export function isTmdbClientEnabled(): boolean {
  const settings = resolveEffectiveTmdbSettings();
  return settings.enabled && !!settings.apiKey;
}

// 设置面板输入校验：留空走默认，填了就必须是 http(s) 地址
export function getTmdbHostInputError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return null;
  }
  return '地址需以 http:// 或 https:// 开头';
}
