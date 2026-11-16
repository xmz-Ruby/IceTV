import { NextRequest, NextResponse } from 'next/server';

import { doubanRouteCache } from '@/app/api/douban/cache';
import {
  doubanUpstreamFetchInit,
  resolveDoubanUpstreamMode,
} from '@/app/api/douban/upstream';
import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { createPrivateApiCacheHeaders } from '@/lib/api-cache-headers';
import { getCacheTime } from '@/lib/config';
import { fetchDoubanData } from '@/lib/douban';
import {
  DoubanCategoryApiResponse,
  normalizeDoubanCategoryItems,
} from '@/lib/douban-normalize';
import { buildDoubanRecentHotUrl } from '@/lib/douban-upstream-url';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import { DoubanResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  const quotaFailure = await requireServerProxyQuota(
    'douban-data',
    request,
    guardResult.username,
  );
  if (quotaFailure) return quotaFailure;

  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = Number(searchParams.get('limit') || '20');
  const pageStart = Number(searchParams.get('start') || '0');

  // 验证参数
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400 },
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 },
    );
  }

  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 },
    );
  }

  if (!Number.isInteger(pageStart) || pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 },
    );
  }

  const upstreamMode = await resolveDoubanUpstreamMode(
    searchParams.get('upstream'),
  );
  const targets = {
    web: buildDoubanRecentHotUrl({
      kind: kind as 'tv' | 'movie',
      category,
      type,
      start: pageStart,
      limit: pageLimit,
    }),
    frodo: buildDoubanRecentHotUrl(
      {
        kind: kind as 'tv' | 'movie',
        category,
        type,
        start: pageStart,
        limit: pageLimit,
      },
      'frodo',
    ),
  };

  try {
    // 调用豆瓣 API：frodo 响应与 web 同形；各自 URL 天然分缓存 key，失败不落缓存
    const loadFrom = (upstream: 'web' | 'frodo') => {
      const url = targets[upstream];
      return doubanRouteCache.getOrLoad(url, () =>
        fetchDoubanData<DoubanCategoryApiResponse>(
          url,
          doubanUpstreamFetchInit(upstream),
        ),
      );
    };
    const doubanData = (await (upstreamMode === 'frodo'
      ? loadFrom('frodo')
      : upstreamMode === 'web'
        ? loadFrom('web')
        : // auto：旧豆瓣优先，失败转 frodo
          loadFrom('web').catch(() =>
            loadFrom('frodo'),
          ))) as DoubanCategoryApiResponse;

    const list = normalizeDoubanCategoryItems(doubanData.items);

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: createPrivateApiCacheHeaders(cacheTime),
    });
  } catch (error) {
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    recordServerProxyFailure('douban-data', error);
    return NextResponse.json({ error: '获取豆瓣数据失败' }, { status: 500 });
  }
}
