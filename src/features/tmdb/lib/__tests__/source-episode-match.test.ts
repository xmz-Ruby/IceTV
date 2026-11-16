import {
  type TmdbEpisodeTarget,
  matchSourceEntryForEpisode,
  rankSourceEpisodeMatches,
} from '@/features/tmdb/lib/source-episode-match';
import type { SearchResult } from '@/lib/types';

function buildResult(part: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '1',
    title: '测试剧',
    poster: '',
    episodes: [],
    episodes_titles: [],
    source: 'src',
    source_name: '源',
    year: '2024',
    ...part,
  };
}

function buildTarget(part: Partial<TmdbEpisodeTarget> = {}): TmdbEpisodeTarget {
  return {
    season: 1,
    episode: 1,
    airDate: '',
    episodeName: '',
    seasonEpisodeCount: 12,
    priorEpisodes: 0,
    strippedTitle: '测试剧',
    showYear: '2024',
    ...part,
  };
}

describe('matchSourceEntryForEpisode 身份与季门控', () => {
  it('片名不符判 unrelated', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({ title: '完全另一部剧' }),
      buildTarget(),
    );
    expect(result.status).toBe('unrelated');
  });

  it('片名前缀（片名+原名后缀）判相关', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({ title: '测试剧：鬼怪 쓸쓰하고 아득한' }),
      buildTarget(),
    );
    expect(result.status).not.toBe('unrelated');
  });

  it('源标题季号与目标季不符判 other-season', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({ title: '测试剧 第三季', episodes: ['u1'] }),
      buildTarget({ season: 2, seasonEpisodeCount: 10 }),
    );
    expect(result.status).toBe('other-season');
  });

  it('季主题名当片名视同本季（不判 other-season）', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({ title: '南洋拾光季', episodes_titles: ['第1集'] , episodes: ['u1'] }),
      buildTarget({
        season: 10,
        seasonEpisodeCount: 1,
        strippedTitle: '中餐厅',
        seasonThemeNames: ['南洋拾光季'],
      }),
    );
    expect(result.status).not.toBe('other-season');
  });
});

describe('matchSourceEntryForEpisode 集定位分层', () => {
  it('episode_groups 分组换算：第 2 季第 3 集 → 第二组内偏移', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: Array.from({ length: 24 }, (_, i) => `u${i + 1}`),
        episode_groups: [
          { label: '第一季', count: 12 },
          { label: '第二季', count: 12 },
        ],
      }),
      buildTarget({ season: 2, episode: 3, priorEpisodes: 12, seasonEpisodeCount: 12 }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('groups');
    expect(result.episodeIndex).toBe(12 + 2);
  });

  it('episode_groups 无目标季分组判缺集', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: Array.from({ length: 24 }, (_, i) => `u${i + 1}`),
        episode_groups: [
          { label: '第一季', count: 12 },
          { label: '第二季', count: 12 },
        ],
      }),
      buildTarget({ season: 3, episode: 1, priorEpisodes: 24, seasonEpisodeCount: 12 }),
    );
    expect(result.status).toBe('missing-episode');
    expect(result.note).toContain('无第 N 季分组');
  });

  it('日期等值层：综艺按播映日期定位', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: ['u1', 'u2'],
        episodes_titles: ['20240503 第5期', '20240510 第6期'],
      }),
      buildTarget({
        season: 1,
        episode: 5,
        airDate: '2024-05-10',
        seasonEpisodeCount: 12,
      }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('date');
    expect(result.episodeIndex).toBe(1);
  });

  it('坐标等值层：S02E05 命中', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: ['u1', 'u2', 'u3'],
        episodes_titles: ['S02E04', 'S02E05', 'S02E06'],
      }),
      buildTarget({ season: 2, episode: 5, priorEpisodes: 10, seasonEpisodeCount: 10 }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('coordinate');
    expect(result.episodeIndex).toBe(1);
  });

  it('相对编号层：无季标第 1 季列表按集号命中', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: Array.from({ length: 12 }, (_, i) => `u${i + 1}`),
        episodes_titles: Array.from({ length: 12 }, (_, i) => `第${i + 1}集`),
      }),
      buildTarget({ episode: 3 }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('number');
    expect(result.episodeIndex).toBe(2);
  });

  it('绝对编号层：连播源（无季标）目标第 3 季第 5 集 → 全剧第 25 集', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: Array.from({ length: 30 }, (_, i) => `u${i + 1}`),
        episodes_titles: Array.from({ length: 30 }, (_, i) => `第${i + 1}集`),
      }),
      buildTarget({
        season: 3,
        episode: 5,
        priorEpisodes: 20,
        seasonEpisodeCount: 10,
      }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('absolute');
    expect(result.episodeIndex).toBe(24);
  });

  it('连播特征下带「第X季」标题的源按季内相对编号命中', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        title: '测试剧 第三季',
        episodes: Array.from({ length: 30 }, (_, i) => `u${i + 1}`),
        episodes_titles: Array.from({ length: 30 }, (_, i) => `第${i + 1}集`),
      }),
      buildTarget({
        season: 3,
        episode: 5,
        priorEpisodes: 20,
        seasonEpisodeCount: 10,
      }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('number');
    expect(result.episodeIndex).toBe(4);
  });

  it('集名相似度层：源用 TMDB 集名当集名', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: ['u1', 'u2'],
        episodes_titles: ['上集回顾', '南宁合伙人'],
      }),
      buildTarget({ episode: 2, episodeName: '南宁合伙人' }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('label');
    expect(result.episodeIndex).toBe(1);
  });

  it('无集名列表按集序对位', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: Array.from({ length: 12 }, (_, i) => `u${i + 1}`),
      }),
      buildTarget({ episode: 4 }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('positional');
    expect(result.episodeIndex).toBe(3);
  });

  it('超出列表规模判缺集', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({
        episodes: Array.from({ length: 8 }, (_, i) => `u${i + 1}`),
        episodes_titles: Array.from({ length: 8 }, (_, i) => `第${i + 1}集`),
      }),
      buildTarget({ episode: 12 }),
    );
    expect(result.status).toBe('missing-episode');
  });

  it('电影目标直接命中第一集', () => {
    const result = matchSourceEntryForEpisode(
      buildResult({ episodes: ['u1'] }),
      buildTarget({ season: 0, episode: 1 }),
    );
    expect(result.status).toBe('matched');
    expect(result.layer).toBe('movie');
    expect(result.episodeIndex).toBe(0);
  });
});

describe('rankSourceEpisodeMatches', () => {
  it('命中 > 缺集 > 其他季，年份匹配优先于未知', () => {
    const matchedYearMismatch = matchSourceEntryForEpisode(
      buildResult({ title: '测试剧', source: 'a', episodes: ['u'], episodes_titles: ['第1集'], year: '1999' }),
      buildTarget({ episode: 1 }),
    );
    const matchedYearMatch = matchSourceEntryForEpisode(
      buildResult({ title: '测试剧', source: 'b', episodes: ['u'], episodes_titles: ['第1集'], year: '2024' }),
      buildTarget({ episode: 1 }),
    );
    const missing = matchSourceEntryForEpisode(
      buildResult({ title: '测试剧', source: 'c', episodes: [] }),
      buildTarget({ episode: 1 }),
    );
    const otherSeason = matchSourceEntryForEpisode(
      buildResult({ title: '测试剧 第二季', source: 'd', episodes: ['u'] }),
      buildTarget({ episode: 1 }),
    );

    const ranked = rankSourceEpisodeMatches([
      otherSeason,
      missing,
      matchedYearMismatch,
      matchedYearMatch,
    ]);
    expect(ranked.map((item) => item.result.source)).toEqual([
      'b',
      'a',
      'c',
      'd',
    ]);
  });
});
