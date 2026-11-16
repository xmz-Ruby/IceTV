import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { configConflictResponse } from '@/lib/api-config-error';
import { getConfig, invalidateConfigCache, saveConfig } from '@/lib/config';
import { normalizeTmdbSettings } from '@/lib/tmdb-settings';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireAdmin(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const body = await request.json();
    const { Enabled, ApiHost, ApiKey, ImageHost } = body as {
      Enabled?: unknown;
      ApiHost?: unknown;
      ApiKey?: unknown;
      ImageHost?: unknown;
    };

    if (
      typeof Enabled !== 'boolean' ||
      typeof ApiHost !== 'string' ||
      typeof ApiKey !== 'string' ||
      typeof ImageHost !== 'string'
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    // host 填了非 http(s) 的值直接拒绝，而不是静默回落默认，避免后台显示与实际不符
    for (const host of [ApiHost, ImageHost]) {
      const trimmed = host.trim();
      if (!trimmed) continue;
      try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          throw new Error('invalid protocol');
        }
      } catch {
        return NextResponse.json(
          { error: '地址必须是 http(s) URL' },
          { status: 400 },
        );
      }
    }

    const normalized = normalizeTmdbSettings({
      Enabled,
      ApiHost,
      ApiKey,
      ImageHost,
    });
    if (normalized.Enabled && !normalized.ApiKey) {
      return NextResponse.json(
        { error: '启用 TMDB 前需先填写 API Key' },
        { status: 400 },
      );
    }

    invalidateConfigCache();
    const adminConfig = await getConfig();
    adminConfig.TmdbConfig = normalized;

    await saveConfig(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    const conflict = configConflictResponse(error);
    if (conflict) return conflict;
    console.error('更新 TMDB 配置失败:', error);
    return NextResponse.json({ error: '更新 TMDB 配置失败' }, { status: 500 });
  }
}
