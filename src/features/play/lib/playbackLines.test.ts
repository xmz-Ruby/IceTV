import { hasDetailContentChange } from '@/features/play/lib/detailContentChange';
import {
  resolvePlaybackLineSwitch,
  retainPlaybackLine,
  selectPlaybackLine,
} from '@/features/play/lib/playbackLines';
import type { SearchResult } from '@/lib/types';

const detail: SearchResult = {
  id: '42',
  title: '电影',
  source: 'cms',
  source_name: 'CMS',
  poster: '',
  year: '2026',
  episodes: ['https://media.example/a.m3u8'],
  episodes_titles: ['正片'],
  playback_line: 'a:1',
  playback_lines: [
    {
      key: 'a:1',
      label: '流畅',
      episodes: ['https://media.example/a.m3u8'],
      episodes_titles: ['正片'],
    },
    {
      key: 'b:1',
      label: '蓝光',
      episodes: ['https://media.example/b.m3u8'],
      episodes_titles: ['正片'],
    },
  ],
};

it('详情回源保留所选线路，同时使用新返回的地址', () => {
  const selected = selectPlaybackLine(detail, 'b:1');
  const fresh = {
    ...detail,
    playback_lines: detail.playback_lines!.map((line) => ({
      ...line,
      episodes: line.episodes.map((url) => `${url}?token=new`),
    })),
  };
  const result = retainPlaybackLine(selected, fresh);
  expect(result.playback_line).toBe('b:1');
  expect(result.episodes).toEqual(['https://media.example/b.m3u8?token=new']);
  expect(detail.playback_line).toBe('a:1');
  expect(detail.episodes).toEqual(['https://media.example/a.m3u8']);
});

it('同集数新增线路也能触发详情更新', () => {
  const old = {
    ...detail,
    playback_line: undefined,
    playback_lines: undefined,
  };
  expect(hasDetailContentChange(old, detail)).toBe(true);
});

it('电影分集使用画质名称时仍可切线，不把 1080p 当成第 1080 集', () => {
  const movie = {
    ...detail,
    episodes_titles: ['1080p'],
    playback_lines: detail.playback_lines!.map((line, index) => ({
      ...line,
      episodes_titles: [index === 0 ? '1080p' : '2160p'],
    })),
  };
  expect(resolvePlaybackLineSwitch(movie, 0, 'b:1')?.episodeIndex).toBe(0);
});

it('所选线路消失或换到其他作品时保留新详情的默认线路', () => {
  const selected = selectPlaybackLine(detail, 'b:1');
  const single = {
    ...detail,
    playback_lines: undefined,
    playback_line: undefined,
  };
  expect(retainPlaybackLine(selected, single)).toBe(single);
  const other = { ...detail, id: '43' };
  expect(retainPlaybackLine(selected, other)).toBe(other);
});
