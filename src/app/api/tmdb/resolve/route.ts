import { NextRequest, NextResponse } from 'next/server';

import {
  buildResolveQueries,
  isTmdbMatchScore,
  scoreTmdbCandidate,
  stripSeasonMarker,
} from '@/features/tmdb/lib/resolve';
import {
  resolveTmdbRuntimeSettings,
  searchTmdb,
  TmdbRequestError,
} from '@/features/tmdb/lib/tmdb.server';
import { tmdbResolveCache } from '@/features/tmdb/lib/tmdb-cache';
import type {
  TmdbMediaType,
  TmdbResolveMatch,
  TmdbResolveResponse,
} from '@/features/tmdb/types';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { createPrivateApiCacheHeaders } from '@/lib/api-cache-headers';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';

export const runtime = 'nodejs';

async function resolveBestMatch(
  title: string,
  year: string,
  preferredType: TmdbMediaType,
): Promise<TmdbResolveResponse> {
  const settings = await resolveTmdbRuntimeSettings();
  if (!settings.enabled) {
    return { status: 'disabled', match: null, strippedTitle: '' };
  }

  const isTv = preferredType !== 'movie';
  const stripped = isTv ? stripSeasonMarker(title) : title;
  const queries = buildResolveQueries(title, stripped);

  let best: { match: TmdbResolveMatch; asTv: boolean } | null = null;
  // 两轮：先按传入类型搜，不过线再用另一类型兜底（同名电影/剧集录错型）
  for (let round = 0; round < 2 && !best; round += 1) {
    const asTv = round === 0 ? isTv : !isTv;
    const mediaType: TmdbMediaType = asTv ? 'tv' : 'movie';
    for (const query of queries) {
      const candidates = await searchTmdb(settings, mediaType, query);
      for (const candidate of candidates) {
        const score = scoreTmdbCandidate(candidate, {
          title,
          cleanedTitle: stripped,
          year,
        });
        if (!isTmdbMatchScore(score)) continue;
        if (!best || score > best.match.score) {
          best = {
            asTv,
            match: {
              mediaType,
              id: candidate.id,
              name: candidate.name,
              originalName: candidate.original_name,
              firstAirDate: candidate.first_air_date || '',
              overview: candidate.overview,
              posterPath: candidate.poster_path,
              score,
            },
          };
        }
      }
    }
  }

  return {
    status: best ? 'ok' : 'no-match',
    match: best?.match ?? null,
    strippedTitle: stripped,
  };
}

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
  const title = (searchParams.get('title') || '').trim();
  const year = (searchParams.get('year') || '').trim();
  const type = searchParams.get('type') === 'movie' ? 'movie' : 'tv';

  if (!title) {
    return NextResponse.json({ error: '缺少必要参数: title' }, { status: 400 });
  }

  const cacheKey = `resolve:${type}:${title}:${year}`;
  try {
    const result = await tmdbResolveCache.getOrLoad(cacheKey, () =>
      resolveBestMatch(title, year, type),
    );
    return NextResponse.json(result, {
      headers: createPrivateApiCacheHeaders(600),
    });
  } catch (error) {
    recordServerProxyFailure('tmdb-data', error);
    if (error instanceof TmdbRequestError) {
      // bad-key 属配置问题，给可定位的文案
      const message =
        error.code === 'bad-key'
          ? 'TMDB API Key 无效'
          : error.code === 'timeout'
            ? 'TMDB 请求超时'
            : 'TMDB 请求失败';
      return NextResponse.json(
        {
          status: 'error',
          match: null,
          strippedTitle: '',
          error: message,
        } satisfies TmdbResolveResponse,
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('TMDB resolve 失败:', error);
    return NextResponse.json(
      {
        status: 'error',
        match: null,
        strippedTitle: '',
        error: 'TMDB 请求失败',
      } satisfies TmdbResolveResponse,
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
