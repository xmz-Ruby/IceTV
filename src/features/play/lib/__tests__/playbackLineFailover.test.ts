import { pickPlaybackLineFailoverTarget } from '@/features/play/lib/playbackLineFailover';
import type { SearchResult } from '@/lib/types';

function buildMultiLineDetail(): SearchResult {
  return {
    id: '1',
    title: '测试剧',
    poster: '',
    source: 'a',
    source_name: 'A',
    year: '2024',
    episodes: ['https://a.example/0.m3u8', 'https://a.example/1.m3u8'],
    episodes_titles: ['第1集', '第2集'],
    playback_line: '线路A:0',
    playback_lines: [
      {
        key: '线路A:0',
        label: '线路A',
        episodes: ['https://a.example/0.m3u8', 'https://a.example/1.m3u8'],
        episodes_titles: ['第1集', '第2集'],
      },
      {
        key: '线路B:0',
        label: '线路B',
        episodes: ['https://b.example/0.m3u8', 'https://b.example/1.m3u8'],
        episodes_titles: ['第1集', '第2集'],
      },
      {
        key: '缺集:0',
        label: '缺集线路',
        episodes: ['https://c.example/0.m3u8'],
        episodes_titles: ['第1集'],
      },
    ],
  };
}

describe('pickPlaybackLineFailoverTarget', () => {
  it('跳过当前线路与已试线路，选出含当前集的线路', () => {
    const detail = buildMultiLineDetail();
    const target = pickPlaybackLineFailoverTarget(detail, 1, new Set());
    expect(target).not.toBeNull();
    expect(target!.key).toBe('线路B:0');
    expect(target!.label).toBe('线路B');
    expect(target!.episodeIndex).toBe(1);
  });

  it('已试线路不再选中，缺当前集的线路被跳过', () => {
    const detail = buildMultiLineDetail();
    const target = pickPlaybackLineFailoverTarget(detail, 1, new Set(['线路B:0']));
    // 只剩缺集线路（没有第 2 集）→ 无可轮换线路
    expect(target).toBeNull();
  });

  it('单线路或无线路详情不可轮换', () => {
    const single = { ...buildMultiLineDetail(), playback_lines: undefined };
    expect(pickPlaybackLineFailoverTarget(single, 0, new Set())).toBeNull();
    const none = { ...buildMultiLineDetail(), playback_lines: [] };
    expect(pickPlaybackLineFailoverTarget(none, 0, new Set())).toBeNull();
  });
});
