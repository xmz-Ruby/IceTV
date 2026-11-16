import {
  readStorage,
  removeStorage,
  writeStorage,
} from '@/lib/browser-storage';

export const TMDB_SETTINGS_STORAGE_KEY = 'tmdbSettings';

export interface TmdbClientSettings {
  enabled: boolean;
  apiHost: string;
  apiKey: string;
  imageHost: string;
}

export const DEFAULT_TMDB_API_HOST = 'https://api.themoviedb.org/3';
export const DEFAULT_TMDB_IMAGE_HOST = 'https://image.tmdb.org/t/p';

// 默认关闭：未写入本地设置时不改变原有点击直进播放的行为
export const DEFAULT_TMDB_SETTINGS: TmdbClientSettings = {
  enabled: false,
  apiHost: DEFAULT_TMDB_API_HOST,
  apiKey: '',
  imageHost: DEFAULT_TMDB_IMAGE_HOST,
};

function normalizeHost(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return fallback;
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function normalizeTmdbClientSettings(
  settings: Partial<TmdbClientSettings> | undefined | null,
): TmdbClientSettings {
  return {
    enabled: settings?.enabled === true,
    apiHost: normalizeHost(settings?.apiHost, DEFAULT_TMDB_API_HOST),
    apiKey: (settings?.apiKey || '').trim(),
    imageHost: normalizeHost(settings?.imageHost, DEFAULT_TMDB_IMAGE_HOST),
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

export function readTmdbSettings(): TmdbClientSettings {
  return normalizeTmdbClientSettings(readStoredSettings());
}

// 存归一化后的值（host 去尾斜杠、非法回落默认、Key 去空白），读侧不再二次判定
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

// 对外可用的判定：开关打开且配置了 Key（host 有默认值，不参与判定）
export function isTmdbClientEnabled(): boolean {
  const settings = readTmdbSettings();
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
