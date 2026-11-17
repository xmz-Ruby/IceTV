import {
  type FragmentMemoryCache,
  type FragmentMemoryEntry,
  type PendingFragment,
  createFragmentEntryFromResponse,
  createLoadStats,
  FRAGMENT_MEMORY_CACHE_LIMITS,
  fragmentMemoryCache,
  isCacheableFragmentUrl,
  pendingFragmentPreloads,
} from '@/features/play/lib/fragmentMemoryCache';

type PreloadFragment = {
  type?: string;
  sn?: number | string;
  level?: number;
  url?: string;
  start?: number;
  duration?: number;
  gap?: boolean;
  bitrateTest?: boolean;
  byteRange?: readonly number[];
};

type PreloadHls = {
  config: {
    maxMaxBufferLength: number;
    fragLoadPolicy: {
      default: { maxTimeToFirstByteMs: number; maxLoadTimeMs: number };
    };
  };
  levels?: Array<{
    details?: { live?: boolean; fragments?: PreloadFragment[] };
  }>;
};

function isSaveDataEnabled() {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData === true
  );
}

// 主轨仍由 hls.js 顺序解码；额外 N-1 个请求只下载接下来会用到的整片，正式加载可接手在途请求。
export function createVodFragmentPreloadController({
  hls,
  video,
  concurrency,
  cache = fragmentMemoryCache,
  fetcher = (url, init) => fetch(url, init),
}: {
  hls: PreloadHls;
  video: Pick<HTMLVideoElement, 'currentTime'>;
  concurrency: number;
  cache?: FragmentMemoryCache;
  fetcher?: typeof fetch;
}) {
  const requests = new Map<string, PendingFragment>();
  const completed = new Set<string>();
  const maxFragmentBytes = Math.floor(
    FRAGMENT_MEMORY_CACHE_LIMITS.maxBytes / Math.max(1, concurrency - 1),
  );
  let disposed = false;
  let level: number | undefined;
  pendingFragmentPreloads.set(hls.config, requests);

  const clearOutside = (urls: Set<string>, abortClaimed = false) => {
    for (const [url, request] of requests) {
      if (!urls.has(url) && (abortClaimed || !request.claimed)) {
        requests.delete(url);
        request.abort();
      }
    }
    for (const url of completed) {
      if (!urls.has(url)) {
        cache.take(url);
        completed.delete(url);
      }
    }
  };

  const preload = (url: string) => {
    const controller = new AbortController();
    const policy = hls.config.fragLoadPolicy.default;
    let timer = setTimeout(
      () => controller.abort(),
      policy.maxTimeToFirstByteMs,
    );
    const task: PendingFragment = {
      abort: () => controller.abort(),
      claimed: false,
      stats: createLoadStats(),
      promise: Promise.resolve(null),
    };
    task.stats.loading.start = performance.now();
    requests.set(url, task);
    task.promise = (async (): Promise<FragmentMemoryEntry | null> => {
      try {
        const response = await fetcher(url, {
          mode: 'cors',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        task.stats.loading.first = performance.now();
        clearTimeout(timer);
        timer = setTimeout(
          () => controller.abort(),
          Math.max(
            0,
            policy.maxLoadTimeMs -
              (task.stats.loading.first - task.stats.loading.start),
          ),
        );
        const declared = Number(response.headers.get('content-length'));
        if (!response.ok || declared > maxFragmentBytes) {
          await response.body?.cancel();
          return null;
        }
        // 浏览器 fetch 的流式正文在读取时限量，不能先 arrayBuffer 再检查大小。
        const reader = response.body?.getReader();
        if (!reader) return null;
        const chunks: Uint8Array[] = [];
        task.stats.total = declared > 0 ? declared : 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          task.stats.loaded += value.byteLength;
          if (task.stats.loaded > maxFragmentBytes) {
            await reader.cancel();
            return null;
          }
          chunks.push(value);
        }
        if (controller.signal.aborted) return null;
        const data = new Uint8Array(task.stats.loaded);
        let offset = 0;
        for (const chunk of chunks) {
          data.set(chunk, offset);
          offset += chunk.byteLength;
        }
        task.stats.loading.end = performance.now();
        task.stats.total = data.byteLength;
        const entry = createFragmentEntryFromResponse(response, data, {
          streamEnded: true,
          requestedBytes: null,
          ttfbMs: task.stats.loading.first - task.stats.loading.start,
          transferMs: task.stats.loading.end - task.stats.loading.first,
        });
        if (!entry?.complete) return null;
        if (!task.claimed && !disposed && cache.put(url, entry)) {
          completed.add(url);
        }
        return entry;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        controller.abort();
        if (requests.get(url) === task) requests.delete(url);
      }
    })();
  };

  const reset = () => clearOutside(new Set());
  const handleFragmentLoading = (fragment: PreloadFragment | undefined) => {
    if (disposed || !fragment || fragment.type !== 'main') return;
    if (isSaveDataEnabled() || concurrency <= 1) {
      reset();
      return;
    }
    const details = hls.levels?.[fragment.level ?? -1]?.details;
    if (
      !details ||
      details.live ||
      typeof fragment.sn !== 'number' ||
      fragment.bitrateTest
    ) {
      reset();
      return;
    }
    if (level !== fragment.level) reset();
    level = fragment.level;
    const fragments = details.fragments ?? [];
    const index = fragments.findIndex((item) => item.sn === fragment.sn);
    if (index < 0) return;
    const head = Number.isFinite(video.currentTime)
      ? video.currentTime
      : (fragment.start ?? 0);
    const urls = new Set(
      fragments
        .slice(index + 1, index + concurrency)
        .filter(
          (item) =>
            !item.gap &&
            !item.byteRange?.length &&
            (item.start ?? head) < head + hls.config.maxMaxBufferLength &&
            isCacheableFragmentUrl(item.url),
        )
        .map((item) => item.url as string),
    );
    clearOutside(urls);
    for (const url of urls) {
      if (!requests.has(url) && !cache.has(url)) {
        preload(url);
      }
    }
  };

  return {
    handleFragmentLoading,
    handleSeeking() {
      const fragments = hls.levels?.[level ?? -1]?.details?.fragments ?? [];
      const position = video.currentTime;
      const index = fragments.findIndex(
        (fragment) =>
          (fragment.start ?? Infinity) <= position + 0.1 &&
          (fragment.start ?? 0) + (fragment.duration ?? 0) > position,
      );
      clearOutside(
        new Set(
          index < 0
            ? []
            : fragments
                .slice(index, index + concurrency)
                .map((fragment) => fragment.url)
                .filter((url): url is string => !!url),
        ),
      );
    },
    reset,
    dispose() {
      disposed = true;
      clearOutside(new Set(), true);
      if (pendingFragmentPreloads.get(hls.config) === requests) {
        pendingFragmentPreloads.delete(hls.config);
      }
    },
  };
}
