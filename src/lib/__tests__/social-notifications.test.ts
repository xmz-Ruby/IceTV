/** @jest-environment node */

import { assertSocialNotifications } from '@/lib/__tests__/__fixtures__/social-notification-contract';
import { videoReview } from '@/lib/__tests__/__fixtures__/video-review-contract';
import { MESSAGE_NOTIFICATION_KINDS } from '@/lib/message-types';
import { socialNotificationId } from '@/lib/social-notification-identity';
import { LocalSqliteStorage } from '@/lib/sqlite.db';
import { mergeUserMessageState } from '@/lib/user-message-state';

it('SQLite 新粉丝与合并点赞、已读、单条公开评价契约', async () => {
  await assertSocialNotifications(
    new LocalSqliteStorage(':memory:'),
    'notification',
  );
});
it.each(['new-follower', 'review-like'] as const)(
  '%s 的有界已读集合与并发重新开启水位',
  (kind) => {
    const field = kind === 'new-follower' ? 'newFollower' : 'reviewLike';
    const id = (time: number) =>
      socialNotificationId(kind, [
        'Author000001',
        kind === 'review-like' ? '作品' : '',
        '',
        time,
      ]);
    const state = mergeUserMessageState(
      { [`${field}ReadIds`]: Array.from({ length: 200 }, (_, i) => id(i + 1)) },
      { [field]: { id: id(201), createdAt: 201 } },
    );
    expect(state[`${field}ReadAt`]).toBe(1);
    expect(state[`${field}ReadIds`]).toHaveLength(200);
    const muted = mergeUserMessageState(state, {
      notificationSettings: { mutedKinds: [kind], now: 100 },
    });
    const reopened = mergeUserMessageState(muted, {
      notificationSettings: { mutedKinds: [], now: 200 },
    });
    expect(reopened[`${field}ReadIds`]).toEqual([id(201)]);
    expect(reopened[`${field}ReadAt`]).toBe(200);
  },
);

it('首次公开迁移原子回填旧时间，私密旧记录恢复公开不回灌，完成后不补写新草稿', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = storage as unknown as {
    db: import('better-sqlite3').Database;
    migrateReviewFirstPublished(): void;
  };
  for (const username of ['author', 'reader'])
    await storage.ensureUserProfile(username);
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
  try {
    await storage.setUserFollow('reader', 'author', true);
    await storage.setVideoReview('author', videoReview);
    const [before] = await storage.getFollowReviewMessages(
      'reader',
      0,
      [],
      3000,
    );
    await storage.setVideoReview('author', {
      ...videoReview,
      title_norm: 'private-old',
      is_public: false,
    });
    impl.db.exec(
      "UPDATE video_reviews SET first_published_at = NULL; DELETE FROM storage_migrations WHERE name = 'review_first_published_v1'",
    );
    impl.db.exec(
      "CREATE TRIGGER fail_review_migration BEFORE INSERT ON storage_migrations BEGIN SELECT RAISE(ABORT, 'interrupt'); END",
    );
    expect(() => impl.migrateReviewFirstPublished()).toThrow('interrupt');
    expect(
      impl.db.prepare('SELECT first_published_at FROM video_reviews').all(),
    ).toEqual([{ first_published_at: null }, { first_published_at: null }]);
    impl.db.exec('DROP TRIGGER fail_review_migration');
    impl.migrateReviewFirstPublished();
    expect(
      await storage.getFollowReviewMessages('reader', 0, [before.id], 3000),
    ).toEqual([]);
    await storage.setVideoReview('author', {
      ...videoReview,
      title_norm: 'private-old',
      updated_at: 8000,
    });
    expect(
      await storage.getFollowReviewMessageCount('reader', 2000, [], 9000),
    ).toBe(0);
    await storage.setVideoReview('author', {
      ...videoReview,
      title_norm: 'new-draft',
      is_public: false,
      updated_at: 9000,
    });
    impl.migrateReviewFirstPublished();
    expect(
      impl.db
        .prepare(
          "SELECT first_published_at FROM video_reviews WHERE title_norm = 'new-draft'",
        )
        .get(),
    ).toEqual({ first_published_at: null });
  } finally {
    clock.mockRestore();
  }
});

it('未保存过设置默认全关，首次开启推进该类水位避免旧消息涌出', () => {
  const reopened = mergeUserMessageState(
    { followReviewReadAt: 50 },
    {
      notificationSettings: {
        mutedKinds: [
          'tracking-update',
          'review-reply',
          'new-follower',
          'review-like',
        ],
        now: 100,
      },
    },
  );
  expect(reopened.mutedKinds).toEqual([
    'tracking-update',
    'review-reply',
    'new-follower',
    'review-like',
  ]);
  expect(reopened.followReviewReadAt).toBe(100);
  // 仍然关闭的类型不推进水位
  expect(reopened.reviewReplyReadAt).toBeUndefined();
});

it('通知默认全关迁移覆写已保存的开关、跳过未设置用户且幂等', async () => {
  const storage = new LocalSqliteStorage(':memory:');
  const impl = storage as unknown as {
    db: import('better-sqlite3').Database;
    migrateNotificationMutedDefault(): void;
  };
  await storage.updateUserMessageState('alice', {
    notificationSettings: { mutedKinds: [], now: 100 },
  });
  await storage.updateUserMessageState('bob', {
    notificationSettings: { mutedKinds: ['review-like'], now: 100 },
  });
  await storage.updateUserMessageState('carol', {
    followReviewReadAt: 555,
  });
  impl.db.exec(
    "DELETE FROM storage_migrations WHERE name = 'notification_muted_default_v1'",
  );
  impl.migrateNotificationMutedDefault();
  expect((await storage.getUserMessageState('alice')).mutedKinds).toEqual([
    ...MESSAGE_NOTIFICATION_KINDS,
  ]);
  expect((await storage.getUserMessageState('bob')).mutedKinds).toEqual([
    ...MESSAGE_NOTIFICATION_KINDS,
  ]);
  // 未保存过开关的用户不改写，由默认解析覆盖
  const carol = await storage.getUserMessageState('carol');
  expect(carol.mutedKinds).toBeUndefined();
  expect(carol.followReviewReadAt).toBe(555);
  // marker 已写入，重复执行为 no-op
  impl.migrateNotificationMutedDefault();
  expect((await storage.getUserMessageState('alice')).mutedKinds).toEqual([
    ...MESSAGE_NOTIFICATION_KINDS,
  ]);
});
