import { installStreamPolyfills } from '@/app/api/test-utils/stream-polyfills';
import {
  createFragmentMemoryCache,
  createLoadStats,
  pendingFragmentPreloads,
  withFragmentMemoryCache,
} from '@/features/play/lib/fragmentMemoryCache';
import { createVodFragmentPreloadController } from '@/features/play/lib/vodFragmentPreload';

installStreamPolyfills();

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  jest.restoreAllMocks();
});

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function setup(concurrency = 4) {
  const fragments = Array.from({ length: 10 }, (_, sn) => ({
    type: 'main',
    sn,
    level: 0,
    start: sn * 4,
    duration: 4,
    url: `https://cms.example/jpys/s/signed-${sn}.bin?e=signature`,
  }));
  const hls = {
    config: {
      maxMaxBufferLength: 120,
      fragLoadPolicy: {
        default: { maxTimeToFirstByteMs: 10_000, maxLoadTimeMs: 120_000 },
      },
    },
    levels: [{ details: { live: false, fragments } }],
  };
  const streams = new Map<
    string,
    ReadableStreamDefaultController<Uint8Array>
  >();
  const signals = new Map<string, AbortSignal>();
  const fetcher = jest.fn(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      const signal = init!.signal as AbortSignal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.set(String(url), controller);
          signal.addEventListener('abort', () => {
            try {
              controller.error(new Error('aborted'));
            } catch {}
          });
        },
      });
      signals.set(String(url), signal);
      return new Response(body, { status: 200 });
    },
  );
  const cache = createFragmentMemoryCache();
  const video = { currentTime: 0 };
  const controller = createVodFragmentPreloadController({
    hls,
    video,
    concurrency,
    cache,
    fetcher,
  });
  cleanups.push(() => controller.dispose());
  const loads = jest.fn();
  class BaseLoader {
    stats = createLoadStats();
    load = loads;
  }
  const Loader = withFragmentMemoryCache(BaseLoader, { cache });
  const callbacks = {
    onSuccess: jest.fn(),
    onError: jest.fn(),
    onTimeout: jest.fn(),
    onAbort: jest.fn(),
    onProgress: jest.fn(),
  };
  const loader = new Loader(hls.config) as unknown as {
    stats: ReturnType<typeof createLoadStats>;
    load: (...args: unknown[]) => void;
    abort: () => void;
  };
  const loadFragment = (sn: number) =>
    loader.load(
      { frag: fragments[sn], part: null, url: fragments[sn].url },
      { timeout: 120_000 },
      callbacks,
    );
  const complete = (sn: number, data = new Uint8Array([1, 2, 3])) => {
    streams.get(fragments[sn].url)!.enqueue(data);
    streams.get(fragments[sn].url)!.close();
  };
  return {
    hls,
    video,
    fragments,
    controller,
    fetcher,
    signals,
    cache,
    loads,
    loader,
    callbacks,
    loadFragment,
    complete,
    streams,
  };
}

it('对 CMS 签名 bin 分片只预取 N-1 片，播放接管在途请求并沿用真实耗时', async () => {
  let now = 100;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  const task = setup();
  task.controller.handleFragmentLoading(task.fragments[0]);
  expect(task.fetcher).toHaveBeenCalledTimes(3);
  now = 200;
  await flush();
  task.loadFragment(1);
  task.streams.get(task.fragments[1].url)!.enqueue(new Uint8Array([8, 9]));
  await flush();
  expect(task.loader.stats.loaded).toBe(2);
  now = 800;
  task.complete(1);
  await flush();
  expect(task.loads).not.toHaveBeenCalled();
  expect(task.callbacks.onSuccess).toHaveBeenCalledTimes(1);
  expect(
    Array.from(new Uint8Array(task.callbacks.onSuccess.mock.calls[0][0].data)),
  ).toEqual([8, 9, 1, 2, 3]);
  expect(
    task.loader.stats.loading.first - task.loader.stats.loading.start,
  ).toBe(100);
  expect(task.loader.stats.loading.end - task.loader.stats.loading.first).toBe(
    600,
  );
  expect(task.fetcher).toHaveBeenCalledTimes(3);
});

it('已完成预取直接复用内存，不依赖 CMS 的 HTTP 缓存头', async () => {
  const task = setup(2);
  task.controller.handleFragmentLoading(task.fragments[0]);
  await flush();
  task.complete(1);
  await flush();
  expect(task.cache.has(task.fragments[1].url)).toBe(true);
  task.loadFragment(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(task.callbacks.onSuccess).toHaveBeenCalledTimes(1);
  expect(task.loads).not.toHaveBeenCalled();
  expect(task.fetcher).toHaveBeenCalledTimes(1);
});

it('初始化定位保留同一窗口的缓存，拖远后清理旧窗口', async () => {
  const task = setup();
  task.controller.handleFragmentLoading(task.fragments[0]);
  await flush();
  task.complete(1);
  await flush();
  task.controller.handleSeeking();
  expect(task.cache.has(task.fragments[1].url)).toBe(true);
  expect(task.signals.get(task.fragments[2].url)!.aborted).toBe(false);
  task.loadFragment(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(task.loads).not.toHaveBeenCalled();
  task.video.currentTime = 32;
  task.controller.handleSeeking();
  expect(task.signals.get(task.fragments[2].url)!.aborted).toBe(true);
  expect(task.cache.getUsage().bytes).toBe(0);
});

it('拖动与切画质取消无用预取，已经被播放接管的请求由播放器取消', async () => {
  const task = setup();
  task.controller.handleFragmentLoading(task.fragments[0]);
  await flush();
  task.loadFragment(1);
  task.controller.reset();
  expect(task.signals.get(task.fragments[1].url)!.aborted).toBe(false);
  expect(task.signals.get(task.fragments[2].url)!.aborted).toBe(true);
  task.loader.abort();
  expect(task.signals.get(task.fragments[1].url)!.aborted).toBe(true);
  await flush();
  expect(task.callbacks.onAbort).toHaveBeenCalledTimes(1);
  expect(task.loads).not.toHaveBeenCalled();
  expect(task.cache.getUsage().bytes).toBe(0);
  task.controller.handleFragmentLoading(task.fragments[5]);
  await flush();
  task.hls.levels.push({
    details: {
      live: false,
      fragments: task.fragments.map((frag) => ({
        ...frag,
        level: 1,
        url: `${frag.url}&level=1`,
      })),
    },
  });
  task.controller.handleFragmentLoading(
    task.hls.levels[1].details.fragments[0],
  );
  expect(task.signals.get(task.fragments[6].url)!.aborted).toBe(true);
  task.controller.dispose();
  expect(pendingFragmentPreloads.has(task.hls.config)).toBe(false);
});

it('预取失败交给正式加载重试，不直接报告播放失败', async () => {
  const task = setup(2);
  task.fetcher.mockResolvedValueOnce(new Response(null, { status: 502 }));
  task.controller.handleFragmentLoading(task.fragments[0]);
  task.loadFragment(1);
  await flush();
  expect(task.loads).toHaveBeenCalledTimes(1);
  expect(task.callbacks.onError).not.toHaveBeenCalled();
  expect(task.callbacks.onTimeout).not.toHaveBeenCalled();
});

it('超大分片在读取时停止，首字节超时沿用播放策略', async () => {
  jest.useFakeTimers();
  try {
    const task = setup(2);
    task.controller.handleFragmentLoading(task.fragments[0]);
    await flush();
    task.streams
      .get(task.fragments[1].url)!
      .enqueue(new Uint8Array(25 * 1024 * 1024));
    await flush();
    expect(task.cache.getUsage().bytes).toBe(0);
    expect(task.signals.get(task.fragments[1].url)!.aborted).toBe(true);
    task.fetcher.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () =>
            reject(new Error('timeout')),
          );
        }),
    );
    task.controller.handleFragmentLoading(task.fragments[2]);
    jest.advanceTimersByTime(10_000);
    await flush();
    expect(pendingFragmentPreloads.get(task.hls.config)?.size).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('暂停在片头时预取仍受当前播放位置的前向时长约束', () => {
  const task = setup();
  task.hls.config.maxMaxBufferLength = 8;
  task.controller.handleFragmentLoading(task.fragments[1]);
  expect(task.fetcher).not.toHaveBeenCalled();
});

it('默认顺序加载、直播与字节范围分片不发额外请求', () => {
  const sequential = setup(1);
  sequential.controller.handleFragmentLoading(sequential.fragments[0]);
  expect(sequential.fetcher).not.toHaveBeenCalled();
  const live = setup();
  live.hls.levels[0].details.live = true;
  live.controller.handleFragmentLoading(live.fragments[0]);
  expect(live.fetcher).not.toHaveBeenCalled();
  const ranges = setup(2);
  Object.assign(ranges.fragments[1], { byteRange: [0, 100] });
  ranges.controller.handleFragmentLoading(ranges.fragments[0]);
  expect(ranges.fetcher).not.toHaveBeenCalled();
});
