import { NextRequest, NextResponse } from 'next/server';

import {
  fetchTmdbSeasonDetail,
  resolveTmdbRuntimeSettings,
  TmdbRequestError,
} from '@/features/tmdb/lib/tmdb.server';
import { tmdbSeasonCache } from '@/features/tmdb/lib/tmdb-cache';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { createPrivateApiCacheHeaders } from '@/lib/api-cache-headers';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  const quotaFailure = await requireServerProxyQuota(
    'tmdb-data',
    request,
    guardResult.username,
  );
  if (quotaFailure) return quotaFailure;

  const { searchParams } = new URL(request.url);
  const id = Number.parseInt(searchParams.get('id') || '', 10);
  const season = Number.parseInt(searchParams.get('season') || '', 10);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(season) || season < 0) {
    return NextResponse.json(
      { error: '缺少必要参数: id 或 season' },
      { status: 400 },
    );
  }

  const settings = await resolveTmdbRuntimeSettings();
  if (!settings.enabled) {
    return NextResponse.json(
      { error: 'TMDB 未启用' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const detail = await tmdbSeasonCache.getOrLoad(`tv-${id}-s${season}`, () =>
      fetchTmdbSeasonDetail(settings, id, season),
    );
    return NextResponse.json(detail, {
      headers: createPrivateApiCacheHeaders(600),
    });
  } catch (error) {
    recordServerProxyFailure('tmdb-data', error);
    const status =
      error instanceof TmdbRequestError && error.code === 'not-found'
        ? 404
        : 502;
    console.error('TMDB 季集失败:', error);
    return NextResponse.json(
      { error: 'TMDB 请求失败' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
