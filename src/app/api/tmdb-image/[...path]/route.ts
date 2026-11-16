import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { getConfigForRead } from '@/lib/config';
import {
  type ProxyStreamResult,
  fetchStreamThroughProxy,
  getProxyUrlForTarget,
} from '@/lib/http-proxy-json';
import { getUpstreamFailureStatus } from '@/lib/proxy-diagnostics';
import {
  assertContentLength,
  createLimitedReadableStream,
  ResponseSizeLimitError,
} from '@/lib/proxy-response-limits';
import { normalizeRuntimeParams } from '@/lib/runtime-params';
import {
  recordServerProxyFailure,
  requireServerProxyQuota,
} from '@/lib/server-proxy-guard';
import { resourceLimitResponse } from '@/lib/server-resource-errors';
import { fetchWithUrlGuard, UrlValidationError } from '@/lib/url-guard';

export const runtime = 'nodejs';

const TMDB_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const TMDB_IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
const TMDB_IMAGE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

// 只放行 size 段（w300 等）与 TMDB 文件名段，拒绝路径穿越与 query
function buildTmdbImageTargetUrl(
  imageHost: string,
  path: string[],
): URL | null {
  if (path.length !== 2) return null;
  if (!/^[a-z0-9_]+$/i.test(path[0])) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(path[1]) || path[1].includes('..')) return null;
  const trimmedHost = imageHost.trim();
  if (!trimmedHost) return null;
  try {
    const url = new URL(`${trimmedHost.replace(/\/+$/, '')}/${path.join('/')}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

async function handleTmdbImage(
  request: NextRequest,
  context: RouteContext,
  method: 'GET' | 'HEAD',
) {
  const guardResult = await requireActiveUser(request, {
    unauthorizedMessage: 'Unauthorized',
    includeUserStateCode: false,
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  const quotaFailure = await requireServerProxyQuota(
    'tmdb-image',
    request,
    guardResult.username,
  );
  if (quotaFailure) return quotaFailure;

  const { path = [] } = await context.params;
  const config = await getConfigForRead();
  const targetUrl = buildTmdbImageTargetUrl(
    config.TmdbConfig?.ImageHost || '',
    path,
  );
  if (!targetUrl) {
    return NextResponse.json({ error: 'Invalid TMDB image' }, { status: 400 });
  }

  const timeoutMs =
    normalizeRuntimeParams(config.SiteConfig).ImageProxyTimeoutSeconds * 1000;

  try {
    const imageResponse = await fetchTmdbImage(targetUrl, method, timeoutMs);
    const contentType = imageResponse.headers.get('content-type');
    if (!contentType?.toLowerCase().startsWith('image/')) {
      imageResponse.body?.cancel().catch(() => {});
      return NextResponse.json(
        { error: 'Invalid image response' },
        { status: 502 },
      );
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', contentType);
    const contentLength = imageResponse.headers.get('content-length');
    const etag = imageResponse.headers.get('etag');
    const lastModified = imageResponse.headers.get('last-modified');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);
    if (etag) responseHeaders.set('ETag', etag);
    if (lastModified) responseHeaders.set('Last-Modified', lastModified);
    // 路由要求登录态，浏览器私有缓存即可
    responseHeaders.set('Cache-Control', 'private, max-age=2592000');

    if (method === 'HEAD') {
      imageResponse.body?.cancel().catch(() => {});
      return new Response(null, { status: 200, headers: responseHeaders });
    }

    try {
      assertContentLength(imageResponse.headers, TMDB_IMAGE_MAX_BYTES);
    } catch (error) {
      await imageResponse.body?.cancel().catch(() => {});
      throw error;
    }

    return new Response(
      createLimitedReadableStream(imageResponse.body, TMDB_IMAGE_MAX_BYTES),
      {
        status: 200,
        headers: responseHeaders,
      },
    );
  } catch (error) {
    recordServerProxyFailure('tmdb-image', error);
    const busy = resourceLimitResponse(error);
    if (busy) return busy;
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }
    if (error instanceof ResponseSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json(
      { error: 'Error fetching TMDB image' },
      { status: getUpstreamFailureStatus(error) },
    );
  }
}

async function fetchTmdbImage(
  targetUrl: URL,
  method: 'GET' | 'HEAD',
  timeoutMs: number,
): Promise<
  Omit<ProxyStreamResult, 'body'> & { body: ProxyStreamResult['body'] | null }
> {
  const proxyUrl = getProxyUrlForTarget(targetUrl);
  if (proxyUrl) {
    return fetchStreamThroughProxy(targetUrl, proxyUrl, {
      timeoutMs,
      userAgent: TMDB_IMAGE_USER_AGENT,
      maxBytes: TMDB_IMAGE_MAX_BYTES,
      accept: TMDB_IMAGE_ACCEPT,
    });
  }

  const response = await fetchWithUrlGuard(targetUrl.toString(), {
    method,
    headers: {
      Accept: TMDB_IMAGE_ACCEPT,
      'User-Agent': TMDB_IMAGE_USER_AGENT,
    },
    timeoutMs,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`TMDB image request failed: ${response.status}`);
  }
  if (method === 'GET' && !response.body) {
    throw new Error('TMDB image response is empty');
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body: response.body,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleTmdbImage(request, context, 'GET');
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  return handleTmdbImage(request, context, 'HEAD');
}
