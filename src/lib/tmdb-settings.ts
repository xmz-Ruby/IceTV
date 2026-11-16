import type { TmdbSettings } from '@/types/admin';

export const DEFAULT_TMDB_API_HOST = 'https://api.themoviedb.org/3';
export const DEFAULT_TMDB_IMAGE_HOST = 'https://image.tmdb.org/t/p';

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

export function normalizeTmdbSettings(
  settings: Partial<TmdbSettings> | undefined,
): TmdbSettings {
  return {
    Enabled: settings?.Enabled === true,
    ApiHost: normalizeHost(settings?.ApiHost, DEFAULT_TMDB_API_HOST),
    ApiKey: (settings?.ApiKey || '').trim(),
    ImageHost: normalizeHost(settings?.ImageHost, DEFAULT_TMDB_IMAGE_HOST),
  };
}

// 对外可用的判定：开关打开且配置了 Key（host 有默认值，不参与判定）
export function isTmdbSettingsEnabled(
  settings: Partial<TmdbSettings> | undefined,
): boolean {
  return settings?.Enabled === true && !!(settings?.ApiKey || '').trim();
}
