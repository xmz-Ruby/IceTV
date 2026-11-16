import {
  episodeNameHasDate,
  episodeNameNumber,
  episodeNameSeason,
  episodeNamesSameDate,
  hasSeasonMarker,
  isSameEpisodeVersion,
  matchEpisodeLabel,
  matchEpisodeNames,
} from '@/features/tmdb/lib/episode-name-matcher';
import { normalizeWorkTitle } from '@/lib/source-match';
import type { SearchResult } from '@/lib/types';

/** TMDB 侧的选集目标（一部剧的一集或一部电影） */
export interface TmdbEpisodeTarget {
  /** 1-based 季号；电影为 0 */
  season: number;
  /** 1-based 集号；电影为 1 */
  episode: number;
  /** TMDB 播映日期 yyyy-MM-dd；未知为空串 */
  airDate: string;
  /** TMDB 集名（集名相似度层） */
  episodeName: string;
  /** 本季总集数（连播源特征与缺集判定） */
  seasonEpisodeCount: number;
  /** 前几季集数合计（绝对编号层；第 1 季为 0） */
  priorEpisodes: number;
  /** 剥季标记后的剧名（即源检索关键词） */
  strippedTitle: string;
  /** TMDB 首播/上映年（软身份排序用） */
  showYear: string;
  /** 本季的 TMDB 季名（综艺主题名当片名的源视同季标记命中） */
  seasonThemeNames?: string[];
}

export type SourceEpisodeMatchStatus =
  | 'matched'
  | 'missing-episode'
  | 'other-season'
  | 'unrelated';

export type SourceEpisodeMatchLayer =
  | 'groups'
  | 'date'
  | 'coordinate'
  | 'number'
  | 'label'
  | 'absolute'
  | 'movie'
  | 'positional'
  | '';

export interface SourceEpisodeMatchResult {
  result: SearchResult;
  status: SourceEpisodeMatchStatus;
  /** 0-based 集下标（result.episodes 当前线路内）；未命中为 null */
  episodeIndex: number | null;
  layer: SourceEpisodeMatchLayer;
  /** 人读的命中/未命中原因，直接进面板展示 */
  note: string;
  yearMatch: 'match' | 'unknown' | 'mismatch';
}

const GROUP_SEASON_RE =
  /第\s*([0-9零〇一二两三四五六七八九十百]{1,3})\s*季|(?:^|\D)s\s*0*(\d{1,2})(?![0-9a-z])|(^|\D)(\d{1,2})(?![0-9a-z])$/i;

function parseGroupSeason(label: string): number {
  const value = (label || '').trim();
  if (!value) return 0;
  const marker = GROUP_SEASON_RE.exec(value);
  if (!marker) return 0;
  const raw = marker[1] || marker[2] || marker[4];
  if (!raw) return 0;
  const digits = Number.parseInt(raw, 10);
  if (Number.isFinite(digits)) return digits > 0 ? digits : 0;
  const cnDigits = '零一二三四五六七八九';
  let total = 0;
  let digit = 0;
  for (const char of raw) {
    if (char === '〇') digit = 0;
    else if (char === '两') digit = 2;
    else if (cnDigits.includes(char)) digit = cnDigits.indexOf(char);
    else if (char === '十') {
      total += (digit === 0 ? 1 : digit) * 10;
      digit = 0;
    }
  }
  total += digit;
  return total > 0 ? total : 0;
}

/** 条目身份：源标题与剥季标记后的剧名是同一部作品（相等或关键词为前缀，防同名衍生剧混入） */
function isSourceEntryRelated(
  sourceTitle: string,
  target: TmdbEpisodeTarget,
): boolean {
  const head = normalizeWorkTitle(target.strippedTitle);
  if (head.length < 2) return false;
  const normalized = normalizeWorkTitle(sourceTitle);
  if (!normalized) return false;
  if (normalized === head || normalized.startsWith(head)) return true;
  // 综艺主题名当片名的源：季名包含即视同相关（收录进面板，季匹配交给季门控）
  const themes = target.seasonThemeNames || [];
  return themes.some((theme) => {
    const normalizedTheme = normalizeWorkTitle(theme);
    return normalizedTheme.length >= 2 && normalized.includes(normalizedTheme);
  });
}

/** 源标题的季号：常规季标记，其次本季主题名命中视同本季 */
function resolveSourceTitleSeason(
  sourceTitle: string,
  target: TmdbEpisodeTarget,
): number {
  const season = episodeNameSeason(sourceTitle);
  if (season > 0) return season;
  const themes = target.seasonThemeNames || [];
  const normalized = normalizeWorkTitle(sourceTitle);
  const themeHit = themes.some((theme) => {
    const normalizedTheme = normalizeWorkTitle(theme);
    return (
      normalizedTheme.length >= 2 &&
      normalized.length >= normalizedTheme.length &&
      normalized.includes(normalizedTheme)
    );
  });
  return themeHit ? target.season : 0;
}

function resolveYearMatch(
  resultYear: string | undefined,
  showYear: string,
): 'match' | 'unknown' | 'mismatch' {
  const sourceYear = Number.parseInt((resultYear || '').trim(), 10);
  const targetYear = Number.parseInt(showYear.trim(), 10);
  if (!Number.isFinite(sourceYear) || sourceYear <= 0) return 'unknown';
  if (!Number.isFinite(targetYear) || targetYear <= 0) return 'unknown';
  if (Math.abs(sourceYear - targetYear) <= 1) return 'match';
  return 'mismatch';
}

/** 双方都解析出日期却不是同一天：集号证据与日期证据矛盾，候选弃权 */
function dateConflictsWithTarget(name: string, target: TmdbEpisodeTarget): boolean {
  if (!target.airDate) return false;
  return episodeNameHasDate(name) && !episodeNamesSameDate(name, target.airDate);
}

interface LayerHit {
  index: number;
  layer: SourceEpisodeMatchLayer;
  note: string;
}

/** ② 坐标等值：条目自带「第N季/SxxExx」标记且与目标一致，先于一切纯数字层 */
function matchCoordinate(
  names: string[],
  target: TmdbEpisodeTarget,
): LayerHit | null {
  if (target.season <= 0 || target.episode <= 0) return null;
  let found = -1;
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i] || '';
    if (episodeNameSeason(name) !== target.season) continue;
    if (episodeNameNumber(name) !== target.episode) continue;
    if (dateConflictsWithTarget(name, target)) continue;
    if (found >= 0 && !isSameEpisodeVersion(names[found], name)) return null;
    if (found < 0) found = i;
  }
  return found >= 0
    ? {
        index: found,
        layer: 'coordinate',
        note: `坐标等值 S${target.season}E${target.episode}`,
      }
    : null;
}

/** ③ 本季相对编号：标题季已验证一致或目标是第 1 季；合成「第N季 第M集 日期」走名称引擎 */
function matchRelative(names: string[], target: TmdbEpisodeTarget): LayerHit | null {
  const synthetic = `第${target.season}季 第${target.episode}集${
    target.airDate ? ` ${target.airDate}` : ''
  }`;
  const index = matchEpisodeNames(names, synthetic);
  return index >= 0
    ? { index, layer: 'number', note: `本季相对编号 第${target.episode}集` }
    : null;
}

/** ⑤ 绝对编号（连播源）：只与无季标条目比对，带季标条目的 E 号是季内坐标会互撞 */
function matchAbsolute(names: string[], target: TmdbEpisodeTarget): LayerHit | null {
  if (target.priorEpisodes <= 0) return null;
  const absolute = target.priorEpisodes + target.episode;
  let found = -1;
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i] || '';
    if (hasSeasonMarker(name)) continue;
    if (episodeNameNumber(name) !== absolute) continue;
    if (dateConflictsWithTarget(name, target)) continue;
    if (found >= 0 && !isSameEpisodeVersion(names[found], name)) return null;
    if (found < 0) found = i;
  }
  return found >= 0
    ? { index: found, layer: 'absolute', note: `全剧绝对编号 第${absolute}集` }
    : null;
}

interface GroupLayout {
  start: number;
  count: number;
  season: number;
}

/** 有可解析季号的分组（EpisodeGroup label 如「第一季」「S2」），组内起点 + 季号 */
function locateSeasonGroups(result: SearchResult): GroupLayout[] {
  const groups = result.episode_groups;
  if (!groups || groups.length < 2) return [];
  const layout: GroupLayout[] = [];
  let start = 0;
  for (const group of groups) {
    const season = parseGroupSeason(group.label || '');
    layout.push({ start, count: group.count, season });
    start += group.count;
  }
  const parsed = layout.filter((group) => group.season > 0);
  // 至少一个组能读出季号才信任分组结构，否则按无分组处理
  return parsed.length > 0 ? layout : [];
}

/**
 * 单个源条目对 TMDB 选集目标的匹配（判定链与手机端 TmdbEpisodeMatcher.explain 同构）：
 * 分组换算 → 日期等值 → 季门控 → 坐标等值 → 本季相对编号 → 集名相似 → 绝对编号。
 */
export function matchSourceEntryForEpisode(
  result: SearchResult,
  target: TmdbEpisodeTarget,
): SourceEpisodeMatchResult {
  const yearMatch = resolveYearMatch(result.year, target.showYear);
  const base = {
    result,
    yearMatch,
    episodeIndex: null as number | null,
    layer: '' as SourceEpisodeMatchLayer,
    note: '',
  };

  if (!isSourceEntryRelated(result.title, target)) {
    return { ...base, status: 'unrelated', note: '片名不符' };
  }

  // 电影：不进季集结构，直接定位第一集（CMS 电影条目几乎都是单「正片」）
  if (target.season <= 0) {
    if (result.episodes.length === 0) {
      return { ...base, status: 'missing-episode', note: '无播放地址' };
    }
    return {
      ...base,
      status: 'matched',
      episodeIndex: 0,
      layer: 'movie',
      note: '电影',
    };
  }

  const total = result.episodes.length;
  if (total === 0) {
    return { ...base, status: 'missing-episode', note: '无播放地址' };
  }

  // 分组结构优先：能读出季号的分组按「第 N 季 → 组内第 M 集」直接换算
  const groups = locateSeasonGroups(result);
  if (groups.length > 0) {
    const group = groups.find(
      (candidate) => candidate.season === target.season && candidate.count > 0,
    );
    if (!group) {
      return { ...base, status: 'missing-episode', note: '该源无第 N 季分组' };
    }
    const offset = target.episode - 1;
    if (offset >= group.count) {
      return {
        ...base,
        status: 'missing-episode',
        note: `第${target.season}季分组仅 ${group.count} 集`,
      };
    }
    return {
      ...base,
      status: 'matched',
      episodeIndex: group.start + offset,
      layer: 'groups',
      note: `分组换算 第${target.season}季第${target.episode}集`,
    };
  }

  const names = (result.episodes_titles || []).slice(0, total);
  const hasNames = names.length === total;

  // ① 日期等值：综艺源集名带日期，与 TMDB air_date 精确对位
  if (hasNames && target.airDate) {
    const index = matchEpisodeNames(names, target.airDate);
    if (index >= 0) {
      return {
        ...base,
        status: 'matched',
        episodeIndex: index,
        layer: 'date',
        note: `播映日期等值 ${target.airDate}`,
      };
    }
  }

  // 季门控：标题明确是别的季 → 数字/集名层全部放弃（only 日期证据有效，上面已试过）
  const titleSeason = resolveSourceTitleSeason(result.title, target);
  if (titleSeason > 0 && target.season > 0 && titleSeason !== target.season) {
    return {
      ...base,
      status: 'other-season',
      note: `该源是第${titleSeason}季内容`,
    };
  }

  const absoluteLikely =
    target.priorEpisodes > 0 &&
    total >= target.priorEpisodes + target.episode &&
    total > target.seasonEpisodeCount;

  if (hasNames) {
    const coordinate = matchCoordinate(names, target);
    if (coordinate) {
      return { ...base, status: 'matched', episodeIndex: coordinate.index, layer: coordinate.layer, note: coordinate.note };
    }

    const relativeAllowed =
      (titleSeason > 0 || target.season <= 1) &&
      (!absoluteLikely || titleSeason === target.season);
    if (relativeAllowed) {
      const relative = matchRelative(names, target);
      if (relative) {
        return { ...base, status: 'matched', episodeIndex: relative.index, layer: relative.layer, note: relative.note };
      }
    }

    if (target.episodeName) {
      const label = matchEpisodeLabel(names, target.episodeName);
      if (label >= 0) {
        return {
          ...base,
          status: 'matched',
          episodeIndex: label,
          layer: 'label',
          note: `集名匹配「${names[label]}」`,
        };
      }
    }

    const absolute = matchAbsolute(names, target);
    if (absolute) {
      return { ...base, status: 'matched', episodeIndex: absolute.index, layer: absolute.layer, note: absolute.note };
    }
  } else {
    // 源没有集名列表：CMS 的 vod_play_url 天然按集序排列，按位置对位
    // （与名称层的假设一致：无季标列表从第 1 集起顺序编号）
    if (
      (titleSeason === target.season || target.season <= 1) &&
      !absoluteLikely &&
      target.episode <= total
    ) {
      return {
        ...base,
        status: 'matched',
        episodeIndex: target.episode - 1,
        layer: 'positional',
        note: `按集序对位 第${target.episode}集`,
      };
    }
    if (absoluteLikely && target.priorEpisodes + target.episode <= total) {
      return {
        ...base,
        status: 'matched',
        episodeIndex: target.priorEpisodes + target.episode - 1,
        layer: 'positional',
        note: `按集序对位 全剧第${target.priorEpisodes + target.episode}集`,
      };
    }
  }

  const seasonHint =
    target.season > 1 && titleSeason === 0
      ? `（源未标注季号，未能定位第${target.season}季第${target.episode}集）`
      : '';
  return {
    ...base,
    status: 'missing-episode',
    note: `缺第${target.season}季第${target.episode}集${seasonHint}`,
  };
}

const STATUS_ORDER: Record<SourceEpisodeMatchStatus, number> = {
  matched: 0,
  'missing-episode': 1,
  'other-season': 2,
  unrelated: 3,
};

const YEAR_ORDER: Record<'match' | 'unknown' | 'mismatch', number> = {
  match: 0,
  unknown: 1,
  mismatch: 2,
};

/** 排序：命中本集 > 缺集 > 其他季；同类按 年份匹配 > 年份未知 > 年份不符；保持稳定序 */
export function rankSourceEpisodeMatches(
  list: SourceEpisodeMatchResult[],
): SourceEpisodeMatchResult[] {
  return list
    .map((item, order) => ({ item, order }))
    .sort((a, b) => {
      const status =
        STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status];
      if (status !== 0) return status;
      const year =
        YEAR_ORDER[a.item.yearMatch] - YEAR_ORDER[b.item.yearMatch];
      if (year !== 0) return year;
      return a.order - b.order;
    })
    .map(({ item }) => item);
}
