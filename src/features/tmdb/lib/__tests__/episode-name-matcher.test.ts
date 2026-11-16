import {
  hasSeasonMarker,
  matchEpisodeLabel,
  matchEpisodeNames,
  parseEpisodeName,
} from '@/features/tmdb/lib/episode-name-matcher';

describe('parseEpisodeName', () => {
  it('解析中文集号与英文 S/E 坐标', () => {
    expect(parseEpisodeName('第01集').episode).toBe(1);
    expect(parseEpisodeName('第 12 期').episode).toBe(12);
    expect(parseEpisodeName('S02E05').season).toBe(2);
    expect(parseEpisodeName('S02E05').episode).toBe(5);
    expect(parseEpisodeName('Season 3 EP07').season).toBe(3);
    expect(parseEpisodeName('Season 3 EP07').episode).toBe(7);
  });

  it('解析裸数字、括号集号与 P 期号', () => {
    expect(parseEpisodeName('08').episode).toBe(8);
    expect(parseEpisodeName('[05]').episode).toBe(5);
    expect(parseEpisodeName('P-02').episode).toBe(2);
    expect(parseEpisodeName('1080p').episode).toBe(0);
  });

  it('解析中文数字集号', () => {
    expect(parseEpisodeName('第二十五集').episode).toBe(25);
    expect(parseEpisodeName('第一百零三话').episode).toBe(103);
  });

  it('解析日期（长格式 / 紧凑格式 / 全角中点）', () => {
    const long = parseEpisodeName('2024.05.03 期');
    expect(long.year).toBe(2024);
    expect(long.month).toBe(5);
    expect(long.day).toBe(3);
    expect(parseEpisodeName('20240503').year).toBe(2024);
    expect(parseEpisodeName('2026·09·26-期').month).toBe(9);
  });

  it('解析部标记', () => {
    expect(parseEpisodeName('第1期上：全员打卡瓜纳华托').part).toBe(1);
    expect(parseEpisodeName('绝叫山丘(下)').part).toBe(3);
    expect(parseEpisodeName('Part 2').part).toBe(2);
  });

  it('网盘文件名提取裸集数并排除体积尾巴', () => {
    expect(parseEpisodeName('[组]01-4K.mp4[1.71GB]').episode).toBe(1);
    expect(parseEpisodeName('S01E03.mkv[5.04GB]').episode).toBe(3);
    // 完整日期命名文件的数字是日期成分不是集数
    expect(parseEpisodeName('[你|H,X]2026·09·26-期.mp4').episode).toBe(0);
  });

  it('季号在原始名上提取（含被前缀标签包裹的 S 标）', () => {
    expect(parseEpisodeName('[S04 露]06 · 30').season).toBe(4);
    expect(parseEpisodeName('第 9 季').season).toBe(9);
    expect(parseEpisodeName('第5期').season).toBe(0);
  });
});

describe('hasSeasonMarker', () => {
  it('识别三种季标形态', () => {
    expect(hasSeasonMarker('第 9 季')).toBe(true);
    expect(hasSeasonMarker('S01E03')).toBe(true);
    expect(hasSeasonMarker('[S04 露]06 · 30')).toBe(true);
    expect(hasSeasonMarker('第5期')).toBe(false);
    expect(hasSeasonMarker('第01集')).toBe(false);
  });
});

describe('matchEpisodeNames', () => {
  it('按集号命中（季号一致约束）', () => {
    const names = ['第1集', '第2集', '第3集'];
    expect(matchEpisodeNames(names, '第2季 第2集')).toBe(1);
    expect(matchEpisodeNames(names, '第4集')).toBe(-1);
  });

  it('合成引用命中带季标的源集名', () => {
    const names = ['第1季 第1集', '第2季 第1集', '第2季 第2集'];
    expect(matchEpisodeNames(names, '第2季 第2集')).toBe(2);
  });

  it('日期等值命中按日期命名的综艺列表', () => {
    const names = ['20240503 期', '20240510 期'];
    expect(matchEpisodeNames(names, '2024-05-03')).toBe(0);
    expect(matchEpisodeNames(names, '2024-05-17')).toBe(-1);
  });

  it('集号证据与日期证据矛盾时弃权', () => {
    const names = ['第5期 07-17', '第5期 07-16'];
    expect(matchEpisodeNames(names, '第5季 第5集 2024-07-17')).toBe(0);
  });
});

describe('matchEpisodeLabel', () => {
  it('精确集名命中', () => {
    const names = ['南宁合伙人', '海口合伙人'];
    expect(matchEpisodeLabel(names, '南宁合伙人')).toBe(0);
  });

  it('相似度命中需明显领先，同号不同名拒绝', () => {
    const names = ['彩蛋第3期', '正片'];
    expect(matchEpisodeLabel(names, '第3期上：全员打卡瓜纳华托')).toBe(-1);
  });
});
