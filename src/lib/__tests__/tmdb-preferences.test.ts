import {
  DEFAULT_TMDB_API_HOST,
  DEFAULT_TMDB_IMAGE_HOST,
  DEFAULT_TMDB_SETTINGS,
  getTmdbHostInputError,
  isTmdbClientEnabled,
  normalizeTmdbClientSettings,
  readTmdbSettings,
  resetTmdbSettings,
  TMDB_SETTINGS_STORAGE_KEY,
  writeTmdbSettings,
} from '../tmdb-preferences';

describe('tmdb preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('未写入时默认关闭且 host 走默认值', () => {
    const settings = readTmdbSettings();
    expect(settings).toEqual(DEFAULT_TMDB_SETTINGS);
    expect(settings.enabled).toBe(false);
    expect(isTmdbClientEnabled()).toBe(false);
  });

  it('归一化：去尾斜杠、非 http(s) 回落默认、Key 去空白、enabled 只认真布尔', () => {
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
      imageHost: DEFAULT_TMDB_IMAGE_HOST,
    });
    expect(
      normalizeTmdbClientSettings({ apiHost: 'mirror.example.com' }).apiHost,
    ).toBe(DEFAULT_TMDB_API_HOST);
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
    expect(JSON.parse(localStorage.getItem(TMDB_SETTINGS_STORAGE_KEY)!)).toEqual(
      {
        enabled: true,
        apiHost: 'https://mirror.example.com/3',
        apiKey: 'abc',
        imageHost: 'https://img.example.com/t/p',
      },
    );
    expect(readTmdbSettings().apiHost).toBe('https://mirror.example.com/3');
    resetTmdbSettings();
    expect(readTmdbSettings().enabled).toBe(false);
  });

  it('损坏的存储回落默认而不是抛错', () => {
    localStorage.setItem(TMDB_SETTINGS_STORAGE_KEY, '{broken');
    expect(readTmdbSettings()).toEqual(DEFAULT_TMDB_SETTINGS);
    localStorage.setItem(TMDB_SETTINGS_STORAGE_KEY, '"just-a-string"');
    expect(readTmdbSettings()).toEqual(DEFAULT_TMDB_SETTINGS);
  });

  it('启用判定要求开关打开且已填 Key', () => {
    writeTmdbSettings({ enabled: true, apiKey: '' });
    expect(isTmdbClientEnabled()).toBe(false);
    writeTmdbSettings({ enabled: false, apiKey: 'abc' });
    expect(isTmdbClientEnabled()).toBe(false);
    writeTmdbSettings({ enabled: true, apiKey: 'abc' });
    expect(isTmdbClientEnabled()).toBe(true);
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
