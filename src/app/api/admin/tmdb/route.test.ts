/** @jest-environment node */

import type { NextRequest } from 'next/server';

import { installWebPolyfills } from '@/app/api/test-utils/web-polyfills';
import { requireAdmin } from '@/lib/api-auth';
import { getConfig, saveConfig } from '@/lib/config';

installWebPolyfills();

jest.mock('@/lib/api-auth', () => ({
  isGuardFailure: jest.fn((result) => Boolean(result?.response)),
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/api-config-error', () => ({
  configConflictResponse: jest.fn(() => null),
}));

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  invalidateConfigCache: jest.fn(),
  saveConfig: jest.fn(),
}));

function createRequest(body: unknown) {
  return { json: async () => body } as NextRequest;
}

function getHandler() {
  const { POST } = require('./route');
  return POST as (request: NextRequest) => Promise<Response>;
}

describe('admin tmdb route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue({ role: 'owner' });
    (saveConfig as jest.Mock).mockResolvedValue(undefined);
  });

  it('保存并归一化 TMDB 配置', async () => {
    const config = { SiteConfig: {}, TmdbConfig: undefined };
    (getConfig as jest.Mock).mockResolvedValue(config);

    const response = await getHandler()(
      createRequest({
        Enabled: true,
        ApiHost: 'https://tmdb.example.com/3/',
        ApiKey: 'test-key',
        ImageHost: '',
      }),
    );

    expect(response.status).toBe(200);
    expect(config.TmdbConfig).toEqual({
      Enabled: true,
      ApiHost: 'https://tmdb.example.com/3',
      ApiKey: 'test-key',
      ImageHost: 'https://image.tmdb.org/t/p',
    });
    expect(saveConfig).toHaveBeenCalledWith(config);
  });

  it('启用但缺少 API Key 时拒绝保存', async () => {
    const response = await getHandler()(
      createRequest({
        Enabled: true,
        ApiHost: '',
        ApiKey: '',
        ImageHost: '',
      }),
    );

    expect(response.status).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('host 不是 http(s) URL 时拒绝保存', async () => {
    const response = await getHandler()(
      createRequest({
        Enabled: false,
        ApiHost: 'ftp://tmdb.example.com',
        ApiKey: 'test-key',
        ImageHost: '',
      }),
    );

    expect(response.status).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it('参数类型错误返回 400', async () => {
    const response = await getHandler()(
      createRequest({ Enabled: 'yes', ApiHost: '', ApiKey: '', ImageHost: '' }),
    );

    expect(response.status).toBe(400);
  });
});
