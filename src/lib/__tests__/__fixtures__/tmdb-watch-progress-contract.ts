import { TMDB_WATCH_PROGRESS_PAGE_SIZE } from '@/lib/tmdb-watch-history';
import type { IStorage, PlayRecord, TmdbWatchProgress } from '@/lib/types';

export async function assertTmdbWatchProgress(storage: IStorage) {
  const user = 'tmdb-progress';
  const progress: TmdbWatchProgress = {
    media_key: 'tv/95842',
    season: 2,
    episode: 3,
    source: 'Source',
    video_id: 'Video',
    source_episode_index: 15,
    position: 120,
    duration: 1500,
    updated_at: 1000,
  };
  const record: PlayRecord = {
    title: 'Source title',
    source_name: 'Source',
    year: '2026',
    cover: '',
    index: 15,
    total_episodes: 24,
    play_time: 120,
    total_time: 1500,
    save_time: 1000,
  };
  await storage.setPlayRecord(user, 'Source+Video', record, progress);
  expect(await storage.getPlayRecord(user, 'Source+Video')).toEqual(record);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(
      user.toUpperCase(),
      progress.media_key,
      2,
    ),
  ).toEqual([progress]);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(
      'tmdb-other',
      progress.media_key,
      2,
    ),
  ).toEqual([]);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(user, progress.media_key, 1),
  ).toEqual([]);

  const switched = {
    ...progress,
    source: 'source',
    video_id: 'video',
    source_episode_index: 3,
    position: 300,
    updated_at: 2000,
  };
  await storage.setTmdbWatchProgress(user, switched);
  await storage.setTmdbWatchProgress('tmdb-other', progress);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(user, progress.media_key, 2),
  ).toEqual([switched]);
  expect(
    await storage.getTmdbWatchProgressBySource(user, 'Source', 'Video'),
  ).toEqual([]);
  expect(
    await storage.getTmdbWatchProgressBySource(user, 'source', 'video'),
  ).toEqual([switched]);
  expect(
    await storage.getTmdbWatchProgressBySource(user, 'source', 'Video'),
  ).toEqual([]);
  // 同一坐标换源覆盖，迟到的旧采集不覆盖新进度；允许真实重播后较小的 position。
  await storage.setTmdbWatchProgress(user, progress);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(user, progress.media_key, 2),
  ).toEqual([switched]);
  const replay = { ...switched, position: 30, updated_at: 3000 };
  await storage.setTmdbWatchProgress(user, replay);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(user, progress.media_key, 2),
  ).toEqual([replay]);

  const broken = {
    ...replay,
    get duration(): number {
      throw new Error('coordinate failure');
    },
  };
  await expect(
    storage.setPlayRecord(
      user,
      'Source+Video',
      { ...record, index: 20 },
      broken,
    ),
  ).rejects.toThrow('coordinate failure');
  expect(await storage.getPlayRecord(user, 'Source+Video')).toEqual(record);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(user, progress.media_key, 2),
  ).toEqual([replay]);

  for (
    let episode = 1;
    episode <= TMDB_WATCH_PROGRESS_PAGE_SIZE + 4;
    episode++
  ) {
    await storage.setTmdbWatchProgress(user, {
      ...progress,
      season: 1,
      episode,
      source_episode_index: episode,
    });
  }
  const first = await storage.getTmdbWatchProgressByMediaKey(
    user,
    progress.media_key,
    1,
  );
  expect(first).toHaveLength(TMDB_WATCH_PROGRESS_PAGE_SIZE + 1);
  const second = await storage.getTmdbWatchProgressByMediaKey(
    user,
    progress.media_key,
    1,
    first[TMDB_WATCH_PROGRESS_PAGE_SIZE - 1].episode,
  );
  expect(second.map((item) => item.episode)).toEqual([101, 102, 103, 104]);
  // 删除继续观看不删除坐标进度；删号则全部清理，其他用户不受影响。
  await storage.deleteAllPlayRecords(user);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(user, progress.media_key, 2),
  ).toEqual([replay]);
  await storage.deleteUser(user);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(user, progress.media_key, 2),
  ).toEqual([]);
  expect(
    await storage.getTmdbWatchProgressBySource(user, 'source', 'video'),
  ).toEqual([]);
  expect(
    await storage.getTmdbWatchProgressByMediaKey(
      'tmdb-other',
      progress.media_key,
      2,
    ),
  ).toEqual([progress]);
}
