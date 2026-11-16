import type { TmdbSeasonSummary } from '@/features/tmdb/types';

// 季标记识别：第X季 / S4 / Season 4 / Part 2（与手机端 DoubanTmdbResolver 同源）
const SEASON_MARKER_RE =
  /第\s*([0-9零〇一二两三四五六七八九十]{1,4})\s*季|(?:^|\s)S(?:eason)?\s*0*(\d{1,2})(?:\b|$)|Part\s*0*(\d{1,2})/i;
// 尾部裸季号：「现在就出发4 / 现在就出发 4」；1~2 位且 >0（「00」不当季号，4 位年份天然不匹配）
const TRAILING_SEASON_RE = /(?:^|\D)(\d{1,2})\s*$/;

function parseChineseNumber(value: string): number {
  let total = 0;
  let digit = 0;
  const digits = '零一二三四五六七八九';
  for (const char of value) {
    if (char === '〇') digit = 0;
    else if (char === '两') digit = 2;
    else if (digits.includes(char)) digit = digits.indexOf(char);
    else if (char === '十') {
      total += (digit === 0 ? 1 : digit) * 10;
      digit = 0;
    }
  }
  return total + digit;
}

function parseSeasonGroup(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed)) return parsed;
  return parseChineseNumber(raw);
}

/** 标题自带季标记（「庆余年 第二季」「S4」「现在就出发4」）→ 季号；无标记返回 -1 */
export function parseSeasonMarker(title: string): number {
  if (!title) return -1;
  const marker = SEASON_MARKER_RE.exec(title);
  if (marker) {
    for (let i = 1; i <= 3; i += 1) {
      const group = marker[i];
      if (group !== undefined) return parseSeasonGroup(group);
    }
  }
  const trailing = TRAILING_SEASON_RE.exec(title.trim());
  if (trailing?.[1]) {
    const value = Number.parseInt(trailing[1], 10);
    if (value > 0) return value;
  }
  return -1;
}

/** 剥离季/期标记（「现在就出发 第四季」「现在就出发4」→「现在就出发」）；电影不调用（续作号属于片名身份） */
export function stripSeasonMarker(title: string): string {
  if (!title) return title;
  let cleaned = title.replace(SEASON_MARKER_RE, '').trim();
  const trailing = TRAILING_SEASON_RE.exec(cleaned);
  if (trailing?.[1]) {
    const value = Number.parseInt(trailing[1], 10);
    if (value > 0) {
      cleaned = cleaned.slice(0, trailing.index + (trailing[0].length - trailing[1].length)).trim();
    }
  }
  return cleaned;
}

export function parseTmdbYear(date: string | null | undefined): number {
  if (!date) return 0;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : 0;
}

const MATCH_PASS_SCORE = 60;

export interface TmdbScoreInput {
  /** 豆瓣条目完整标题（可能带季标记） */
  title: string;
  /** 剥掉季标记的清洗名（剧集用；电影传原 title） */
  cleanedTitle: string;
  /** 豆瓣条目年份 */
  year: string;
}

export interface TmdbScoreCandidate {
  name: string;
  original_name: string;
  first_air_date: string | null;
  vote_count: number;
}

/**
 * 候选打分（与手机端 score() 同源，web 侧无豆瓣 aka/原名，比对目标相应减少）：
 * 名称精确 +80 / original_name 精确 +70 / 年份差 ≤1 +10、≤4 +2、>4 -15 / 知名度封顶 +5。
 */
export function scoreTmdbCandidate(
  candidate: TmdbScoreCandidate,
  input: TmdbScoreInput,
): number {
  const { title, cleanedTitle, year } = input;
  let score = 0;
  const name = candidate.name || '';
  const originalName = candidate.original_name || '';
  if (name && (name === title || name === cleanedTitle)) {
    score += 80;
  } else if (
    originalName &&
    (originalName === title || originalName === cleanedTitle)
  ) {
    score += 70;
  }
  const candidateYear = parseTmdbYear(candidate.first_air_date);
  const targetYear = parseTmdbYear(year);
  if (candidateYear > 0 && targetYear > 0) {
    const yearDiff = Math.abs(candidateYear - targetYear);
    if (yearDiff <= 1) score += 10;
    else if (yearDiff <= 4) score += 2;
    else score -= 15;
  }
  score += Math.min(5, Math.floor((candidate.vote_count || 0) / 100));
  return score;
}

export function isTmdbMatchScore(score: number): boolean {
  return score >= MATCH_PASS_SCORE;
}

export function buildResolveQueries(title: string, cleaned: string): string[] {
  const queries: string[] = [];
  for (const query of [cleaned, title]) {
    const trimmed = query.trim();
    if (trimmed && !queries.includes(trimmed)) queries.push(trimmed);
  }
  return queries;
}

/** 初始季推断：标题季标记 → 豆瓣年份等于某季首播年（唯一才算）→ 最新有集季 */
export function inferInitialSeason(
  seasons: TmdbSeasonSummary[],
  options: { markerSeason: number; doubanYear: string },
): number {
  if (options.markerSeason > 0) return options.markerSeason;

  const targetYear = parseTmdbYear(options.doubanYear);
  if (targetYear > 0) {
    let found = -1;
    for (const season of seasons) {
      if (season.season_number <= 0) continue;
      if (parseTmdbYear(season.air_date) !== targetYear) continue;
      if (found > 0) {
        found = -1;
        break;
      }
      found = season.season_number;
    }
    if (found > 0) return found;
  }

  let latestSeason = -1;
  let latestAirDate = '';
  for (const season of seasons) {
    if (season.season_number <= 0 || season.episode_count <= 0) continue;
    const airDate = season.air_date || '';
    if (airDate >= latestAirDate) {
      latestAirDate = airDate;
      latestSeason = season.season_number;
    }
  }
  return latestSeason;
}
