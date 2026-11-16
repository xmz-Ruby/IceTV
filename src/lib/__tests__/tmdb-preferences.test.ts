import type { RuntimeConfig } from '@/lib/runtime-config';

import {
  DEFAULT_TMDB_API_HOST,
  DEFAULT_TMDB_IMAGE_HOST,
  getTmdbHostInputError,
  getTmdbSiteDefaults,
  isTmdbClientEnabled,
  normalizeTmdbClientSettings,
  readTmdbSettings,
  resetTmdbSettings,
  resolveEffectiveTmdbSettings,
  TMDB_SETTINGS_STORAGE_KEY,
  writeTmdbSettings,
} from '../tmdb-preferences';

// 站点默认经 window.RUNTIME_CONFIG 下发，测试里直接注入
function setRuntimeConfig(
  overrides: Partial<
    Pick<
      RuntimeConfig,
      | 'TMDB_DEFAULT_ENABLED'
      | 'TMDB_DEFAULT_API_HOST'
      | 'TMDB_DEFAULT_API_KEY'
      | 'TMDB_DEFAULT_IMAGE_HOST'
    >
  >,
) {
  window.RUNTIME_CONFIG = {
    TMDB_DEFAULT_ENABLED: false,
    TMDB_DEFAULT_API_HOST: DEFAULT_TMDB_API_HOST,
    TMDB_DEFAULT_API_KEY: '',
    TMDB_DEFAULT_IMAGE_HOST: DEFAULT_TMDB_IMAGE_HOST,
    ...overrides,
  } as RuntimeConfig;
}

const SITE_MIRROR = 'https://mirror.example.com/3';
const SITE_KEY = 'site-key';

describe('tmdb preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.RUNTIME_CONFIG;
  });

  it('未写入且无站点默认时关闭、host 为空（= 跟随默认）', () => {
    const settings = readTmdbSettings();
    expect(settings).toEqual({
      enabled: false,
      apiHost: '',
      apiKey: '',
      imageHost: '',
    });
    expect(settings.enabled).toBe(false);
    expect(isTmdbClientEnabled()).toBe(false);
  });

  it('归一化：去尾斜杠、非 http(s) 置空、Key 去空白、enabled 只认真布尔', () => {
    expect(
      normalizeTmdbClientSettings({
        enabled: 'yes' as unknown as boolean,
        apiHost: 'https://mirror.example.com/3/',
        apiKey: '  key  ',
        imageHost: '',
      }),
    ).toEqual({
      enabled: false,
      apiHost: 'https://mirror.example.com/3',
      apiKey: 'key',
      imageHost: '',
    });
    // 非法与缺失 host 都归一化为空串（继承站点默认），不再回落具体地址
    expect(
      normalizeTmdbClientSettings({ apiHost: 'mirror.example.com' }).apiHost,
    ).toBe('');
  });

  it('写入存归一化后的值，读取回环一致', () => {
    expect(
      writeTmdbSettings({
        enabled: true,
        apiHost: 'https://mirror.example.com/3/',
        apiKey: ' abc ',
        imageHost: 'https://img.example.com/t/p/',
      }),
    ).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(TMDB_SETTINGS_STORAGE_KEY)!),
    ).toEqual({
      enabled: true,
      apiHost: 'https://mirror.example.com/3',
      apiKey: 'abc',
      imageHost: 'https://img.example.com/t/p',
    });
    expect(readTmdbSettings().apiHost).toBe('https://mirror.example.com/3');
    resetTmdbSettings();
    expect(readTmdbSettings().enabled).toBe(false);
  });

  it('损坏的存储回落全空（= 全部跟随站点默认）而不是抛错', () => {
    localStorage.setItem(TMDB_SETTINGS_STORAGE_KEY, '{broken');
    expect(readTmdbSettings()).toEqual({
      enabled: false,
      apiHost: '',
      apiKey: '',
      imageHost: '',
    });
    localStorage.setItem(TMDB_SETTINGS_STORAGE_KEY, '"just-a-string"');
    expect(readTmdbSettings().enabled).toBe(false);
  });

  it('无站点默认时启用判定要求开关打开且已填 Key', () => {
    writeTmdbSettings({ enabled: true, apiKey: '' });
    expect(isTmdbClientEnabled()).toBe(false);
    writeTmdbSettings({ enabled: false, apiKey: 'abc' });
    expect(isTmdbClientEnabled()).toBe(false);
    writeTmdbSettings({ enabled: true, apiKey: 'abc' });
    expect(isTmdbClientEnabled()).toBe(true);
  });

  it('站点默认：无 runtime 配置回落内置默认（关闭 + 官方地址）', () => {
    expect(getTmdbSiteDefaults()).toEqual({
      enabled: false,
      apiHost: DEFAULT_TMDB_API_HOST,
      apiKey: '',
      imageHost: DEFAULT_TMDB_IMAGE_HOST,
    });
  });

  it('站点默认经 RUNTIME_CONFIG 提供时，未写本地设置的用户开箱即用', () => {
    setRuntimeConfig({
      TMDB_DEFAULT_ENABLED: true,
      TMDB_DEFAULT_API_HOST: SITE_MIRROR,
      TMDB_DEFAULT_API_KEY: SITE_KEY,
    });
    expect(getTmdbSiteDefaults()).toEqual({
      enabled: true,
      apiHost: SITE_MIRROR,
      apiKey: SITE_KEY,
      imageHost: DEFAULT_TMDB_IMAGE_HOST,
    });
    expect(isTmdbClientEnabled()).toBe(true);
    expect(resolveEffectiveTmdbSettings()).toEqual({
      enabled: true,
      apiHost: SITE_MIRROR,
      apiKey: SITE_KEY,
      imageHost: DEFAULT_TMDB_IMAGE_HOST,
    });
  });

  it('生效配置：本地空字段继承站点默认，显式值覆盖', () => {
    setRuntimeConfig({
      TMDB_DEFAULT_ENABLED: true,
      TMDB_DEFAULT_API_HOST: SITE_MIRROR,
      TMDB_DEFAULT_API_KEY: SITE_KEY,
      TMDB_DEFAULT_IMAGE_HOST: 'https://img.example.com/t/p',
    });
    // 开着但只填了自己的 host：Key/图片继承站点默认
    writeTmdbSettings({ enabled: true, apiHost: 'https://own.example.com/3' });
    expect(resolveEffectiveTmdbSettings()).toEqual({
      enabled: true,
      apiHost: 'https://own.example.com/3',
      apiKey: SITE_KEY,
      imageHost: 'https://img.example.com/t/p',
    });
    // 显式关掉：即使站点默认开也不生效
    writeTmdbSettings({ enabled: false });
    expect(resolveEffectiveTmdbSettings().enabled).toBe(false);
    expect(isTmdbClientEnabled()).toBe(false);
    // 本地没有 enabled 字段（部分 JSON）时继承站点默认开关
    localStorage.setItem(
      TMDB_SETTINGS_STORAGE_KEY,
      JSON.stringify({ apiKey: 'own-key' }),
    );
    expect(resolveEffectiveTmdbSettings()).toEqual({
      enabled: true,
      apiHost: SITE_MIRROR,
      apiKey: 'own-key',
      imageHost: 'https://img.example.com/t/p',
    });
  });

  it('host 输入校验：留空合法，填了必须是 http(s)', () => {
    expect(getTmdbHostInputError('')).toBeNull();
    expect(getTmdbHostInputError('  ')).toBeNull();
    expect(getTmdbHostInputError('https://a.example.com/3')).toBeNull();
    expect(getTmdbHostInputError('http://a.example.com/3')).toBeNull();
    expect(getTmdbHostInputError('a.example.com')).not.toBeNull();
    expect(getTmdbHostInputError('ftp://a.example.com')).not.toBeNull();
  });
});
