// 集名解析与匹配引擎，移植自手机端 EpisodeMatcher（保持分层与守卫语义）。
// 与站点内 normalizeWorkTitle 的分工：这里负责「集标题 → 季/集/日期/部」证据提取，
// 身份（是不是这部剧）由 source-episode-match.ts 用站点统一的 normalizeWorkTitle 判。

const DISPLAY_PREFIX_RE = /^\[(\d+)](.+)$/;
// 发布组/来源前缀标签：[H哈哈H哈H(2025)]、【qq】 等，匹配前统一剥掉
const BRACKET_TAG_RE = /^[【[][^】\]]{0,32}[】\]]\s*(.+)$/;
const SEASON_EPISODE_RE = /s(?:eason)?\s*0*(\d{1,2})\s*e(?:p)?\s*0*(\d{1,4})/i;
const ENGLISH_EPISODE_RE = /(?:^|[^a-z0-9])(?:e|ep|episode)\s*0*(\d{1,4})(?:$|[^0-9])/i;
// 综艺源的「P=期」命名：P-02 / P02 / 第P2期；p 前必须是非字母数字（排除 1080p/mp4 的 p）
const P_EPISODE_RE = /(?:^|[^a-z0-9])p\s*[-_.~]?\s*0*(\d{1,4})(?![0-9a-z])/i;
const CHINESE_EPISODE_RE = /第\s*([0-9零〇一二两三四五六七八九十百]{1,6})\s*[集期话]/;
const QUOTED_EPISODE_RE = /^《[^》]+》\s*0*(\d{1,4})\s*[:：]/;
const SHORT_EPISODE_RE = /^\s*0*(\d{1,4})\s*[集期话]\s*$/;
const NUMBER_ONLY_RE = /^\s*0*(\d{1,4})\s*$/;
const BRACKET_EPISODE_RE = /^\s*\[0*(\d{1,4})]\s*$/;
const CHINESE_SEASON_RE = /第\s*([0-9零〇一二两三四五六七八九十百]{1,4})\s*季/;
// 独立 S 季号（不带 E）："[S04 露]06 · 30" → season=4，否则季校验失效只剩集号对位
const ENGLISH_SEASON_RE = /(?:^|[^a-z0-9])s\s*0*(\d{1,2})(?![0-9a-z])/i;
// 日期结尾不得紧跟拉丁字母（"01-4K.mp4" 不能误读成 1 月 4 日）；分隔符含全角中点
// （原实现用 lookbehind，这里用边界捕获组替代以兼容旧 Safari）
const LONG_DATE_RE = /(^|\D)(20\d{2})[.·/\-年](\d{1,2})[.·/\-月](\d{1,2})日?(?!\d)(?![a-z])/i;
const SHORT_DATE_RE = /(^|\D)(\d{1,2})[.·/\-月](\d{1,2})日?(?!\d)(?![a-z])/i;
const COMPACT_DATE_RE = /(^|\D)(20\d{2})(\d{2})(\d{2})(?!\d)/;
const WESTERN_PART_RE = /(?:part|pt)\s*0*(\d{1,2})/i;
// 综艺常见的嵌入式部标记：第1期上：xxx（上/中/下后面跟标题）
const EMBEDDED_PART_RE = /第\s*[0-9零〇一二两三四五六七八九十百]{1,6}\s*[集期话]\s*([上下中])/;
// 括号式部标记：绝叫山丘(下)，全半角都认
const PAREN_PART_RE = /[（(]\s*([上下中])\s*[)）]/;
const NOISE_RE =
  /2160p|1080p|720p|4k|uhd|fhd|hdr10|hdr|dolby|hevc|avc|h26[45]|高清|超清|蓝光|国语|粤语|中字|无字/gi;
// 网盘/Emby 风格文件名集（带视频扩展名或体积标记）
const FILENAME_LIKE_RE =
  /\.(mp4|mkv|ts|avi|mov|flv|rmvb|wmv|m2ts|mp3)[\]\s.]|\[\d+(?:\.\d+)?\s*(?:gb|mb)\]/i;
const SIZE_TAG_RE = /\[\d+(?:\.\d+)?\s*(?:gb|mb)\]/gi;
const TAIL_EXTENSION_RE = /\.[a-z0-9]{2,4}$/i;
// 尾部长数字串（重传时间戳/流水号）不是内容差异，比对前剥掉；5 位起步
const TAIL_SERIAL_RE = /(^|\D)\d{5,}[.。_\-～~]*$/;
// 尾部品质/版本标签：02 [1080P] / 第6期 [4K]，剥掉后重试短式集号解析
const TAIL_TAG_RE = /^\s*(.{1,32}?)\s*[【[][^】\]]{0,16}[】\]]\s*$/;
// 文件名里的裸集数：前后不能是字母数字，后面必须紧跟分隔符，且不是「数字.数字」
const FILENAME_EPISODE_RE =
  /(^|[^0-9A-Za-z])([0-9]{1,3})(?![0-9A-Za-z])(?!\.\d)(?=[~\-_.\s\]\)）»:：,，;；((（])/g;

export interface EpisodeNameProfile {
  /** 归一化全文（小写、全角数字转半角、只留字母数字与中日韩文字） */
  normalized: string;
  /** 剥噪后的相似度比对名 */
  similarityName: string;
  /** 同集多版本判定名（再剥扩展名/体积/流水号） */
  versionName: string;
  season: number;
  episode: number;
  year: number;
  month: number;
  day: number;
  /** 部标记：1 上/前篇，2 中，3 下/后篇 */
  part: number;
}

function parseChineseNumber(value: string): number {
  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const digits = '零一二三四五六七八九';
  let total = 0;
  let digit = 0;
  for (const char of value) {
    let current = -1;
    if (char === '〇') current = 0;
    else if (char === '两') current = 2;
    else if (digits.includes(char)) current = digits.indexOf(char);
    if (current >= 0) {
      digit = current;
      continue;
    }
    const unit = char === '十' ? 10 : char === '百' ? 100 : 0;
    if (unit > 0) {
      total += (digit === 0 ? 1 : digit) * unit;
      digit = 0;
    }
  }
  return total + digit;
}

function stripDisplayPrefix(value: string): string {
  let current = value;
  let matcher = DISPLAY_PREFIX_RE.exec(current);
  while (matcher) {
    current = matcher[2].trim();
    matcher = DISPLAY_PREFIX_RE.exec(current);
  }
  let tag = BRACKET_TAG_RE.exec(current);
  while (tag) {
    current = tag[1].trim();
    tag = BRACKET_TAG_RE.exec(current);
  }
  return current;
}

// Java Character.isLetterOrDigit 对中文返回 true，这里用 Unicode 字母/数字类别对齐
function normalizeName(value: string): string {
  let lower = value.toLowerCase();
  lower = lower.replace(/[０-９]/g, (char) =>
    String.fromCharCode('0'.charCodeAt(0) + char.charCodeAt(0) - '０'.charCodeAt(0)),
  );
  let builder = '';
  for (const char of lower) {
    if (/[\p{L}\p{N}]/u.test(char)) builder += char;
  }
  return builder;
}

function parseFilenameEpisode(value: string): number {
  if (!FILENAME_LIKE_RE.test(value)) return 0;
  FILENAME_EPISODE_RE.lastIndex = 0;
  let matcher = FILENAME_EPISODE_RE.exec(value);
  while (matcher) {
    const number = Number.parseInt(matcher[2], 10);
    if (number >= 1 && number <= 500) return number;
    matcher = FILENAME_EPISODE_RE.exec(value);
  }
  return 0;
}

function setDate(profile: EpisodeNameProfile, value: string): void {
  let matcher = LONG_DATE_RE.exec(value);
  if (matcher) {
    profile.year = parseChineseNumber(matcher[2]);
    profile.month = parseChineseNumber(matcher[3]);
    profile.day = parseChineseNumber(matcher[4]);
  } else if ((matcher = COMPACT_DATE_RE.exec(value))) {
    profile.year = parseChineseNumber(matcher[2]);
    profile.month = parseChineseNumber(matcher[3]);
    profile.day = parseChineseNumber(matcher[4]);
  } else if ((matcher = SHORT_DATE_RE.exec(value))) {
    profile.month = parseChineseNumber(matcher[2]);
    profile.day = parseChineseNumber(matcher[3]);
  }
  if (profile.month > 12 || profile.day > 31) {
    profile.month = 0;
    profile.day = 0;
    profile.year = 0;
  }
}

function parsePart(value: string): number {
  const embedded = EMBEDDED_PART_RE.exec(value);
  if (embedded) return embedded[1] === '上' ? 1 : embedded[1] === '中' ? 2 : 3;
  const paren = PAREN_PART_RE.exec(value);
  if (paren) return paren[1] === '上' ? 1 : paren[1] === '中' ? 2 : 3;
  const western = WESTERN_PART_RE.exec(value);
  if (western) return parseChineseNumber(western[1]);
  if (value.includes('前篇')) return 1;
  if (value.includes('后篇')) return 2;
  if (/(?:上篇|上集|上)$/.test(value)) return 1;
  if (/(?:中篇|中集|中)$/.test(value)) return 2;
  if (/(?:下篇|下集|下)$/.test(value)) return 3;
  return 0;
}

const profileCache = new Map<string, EpisodeNameProfile>();

export function parseEpisodeName(name: string | null | undefined): EpisodeNameProfile {
  const raw = (name == null ? '' : name).trim();
  const cached = profileCache.get(raw);
  if (cached) return cached;

  const value = stripDisplayPrefix(raw);
  const profile: EpisodeNameProfile = {
    normalized: normalizeName(value),
    similarityName: normalizeName(value.replace(NOISE_RE, '')),
    versionName: '',
    season: 0,
    episode: 0,
    year: 0,
    month: 0,
    day: 0,
    part: 0,
  };

  let bare = value.replace(SIZE_TAG_RE, ' ').trim();
  bare = bare.replace(TAIL_EXTENSION_RE, '');
  bare = bare.replace(TAIL_SERIAL_RE, '$1');
  profile.versionName = normalizeName(bare.replace(NOISE_RE, ''));

  // 日期先于集数解析：完整日期命名文件里的裸数字不是集数
  setDate(profile, value);
  let matcher = SEASON_EPISODE_RE.exec(value);
  if (matcher) {
    profile.season = parseChineseNumber(matcher[1]);
    profile.episode = parseChineseNumber(matcher[2]);
  } else if ((matcher = CHINESE_EPISODE_RE.exec(value))) {
    profile.episode = parseChineseNumber(matcher[1]);
  } else if ((matcher = ENGLISH_EPISODE_RE.exec(value))) {
    profile.episode = parseChineseNumber(matcher[1]);
  } else if ((matcher = QUOTED_EPISODE_RE.exec(value))) {
    profile.episode = parseChineseNumber(matcher[1]);
  } else if ((matcher = P_EPISODE_RE.exec(value))) {
    // 范围守卫：p-2024-05-16.mp4 的年份串不是期号
    const pNumber = parseChineseNumber(matcher[1]);
    if (pNumber >= 1 && pNumber <= 500) profile.episode = pNumber;
  } else if (
    (matcher = SHORT_EPISODE_RE.exec(value)) ||
    (matcher = NUMBER_ONLY_RE.exec(value)) ||
    (matcher = BRACKET_EPISODE_RE.exec(value))
  ) {
    profile.episode = parseChineseNumber(matcher[1]);
  } else if (profile.year === 0 || profile.month === 0 || profile.day === 0) {
    profile.episode = parseFilenameEpisode(value);
  }
  if (profile.episode === 0 && profile.month === 0 && profile.day === 0) {
    // "02 [1080P]" 式集名：尾部标签挡住短式集号，剥掉重试（名称带日期成分时不重试）
    const tag = TAIL_TAG_RE.exec(value);
    if (tag) {
      const head = tag[1].trim();
      const retry =
        SHORT_EPISODE_RE.exec(head) || NUMBER_ONLY_RE.exec(head) || BRACKET_EPISODE_RE.exec(head);
      if (retry) {
        const parsed = parseChineseNumber(retry[1]);
        if (parsed >= 1 && parsed <= 500) profile.episode = parsed;
      }
    }
  }

  // 季号在原始名上提取：季号常在 "[S04 露]" 前缀里，会被标签剥掉
  let seasonMatcher = CHINESE_SEASON_RE.exec(raw);
  if (profile.season === 0 && seasonMatcher) {
    profile.season = parseChineseNumber(seasonMatcher[1]);
  }
  if (profile.season === 0 && (seasonMatcher = ENGLISH_SEASON_RE.exec(raw))) {
    profile.season = parseChineseNumber(seasonMatcher[1]);
  }
  profile.part = parsePart(value);

  if (profileCache.size > 2000) profileCache.clear();
  profileCache.set(raw, profile);
  return profile;
}

function diceBigram(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const used = new Array<boolean>(right.length - 1).fill(false);
  let common = 0;
  for (let i = 0; i < left.length - 1; i += 1) {
    for (let j = 0; j < right.length - 1; j += 1) {
      if (
        used[j] ||
        left.charAt(i) !== right.charAt(j) ||
        left.charAt(i + 1) !== right.charAt(j + 1)
      ) {
        continue;
      }
      used[j] = true;
      common += 1;
      break;
    }
  }
  return (2 * common) / (left.length + right.length - 2);
}

function compatiblePart(source: EpisodeNameProfile, target: EpisodeNameProfile): boolean {
  return source.part === 0 || target.part === 0 || source.part === target.part;
}

function conflictingDate(
  source: EpisodeNameProfile,
  target: EpisodeNameProfile,
): boolean {
  if (source.month <= 0 || target.month <= 0) return false;
  if (source.month !== target.month || source.day !== target.day) return true;
  return source.year > 0 && target.year > 0 && source.year !== target.year;
}

function conflictsWith(
  source: EpisodeNameProfile,
  target: EpisodeNameProfile,
): boolean {
  if (source.episode > 0 && target.episode > 0 && source.episode !== target.episode)
    return true;
  if (source.season > 0 && target.season > 0 && source.season !== target.season)
    return true;
  if (
    source.month > 0 &&
    target.month > 0 &&
    (source.month !== target.month || source.day !== target.day)
  )
    return true;
  return source.part > 0 && target.part > 0 && source.part !== target.part;
}

function sameVersion(left: EpisodeNameProfile, right: EpisodeNameProfile): boolean {
  return diceBigram(left.versionName, right.versionName) >= 0.72;
}

export function isSameEpisodeVersion(left: string, right: string): boolean {
  return sameVersion(parseEpisodeName(left), parseEpisodeName(right));
}

/** 名称是否带季标记（S01E03 / 第 9 季 / [S04 露]） */
export function hasSeasonMarker(name: string | null | undefined): boolean {
  const value = (name == null ? '' : name).trim();
  return (
    SEASON_EPISODE_RE.test(value) ||
    CHINESE_SEASON_RE.test(value) ||
    ENGLISH_SEASON_RE.test(value)
  );
}

export function episodeNameSeason(name: string | null | undefined): number {
  return parseEpisodeName(name).season;
}

export function episodeNameNumber(name: string | null | undefined): number {
  return parseEpisodeName(name).episode;
}

/** 名称里是否解析出了日期（月+日） */
export function episodeNameHasDate(name: string | null | undefined): boolean {
  const profile = parseEpisodeName(name);
  return profile.month > 0 && profile.day > 0;
}

/** 两个名称是否指向同一天（年份仅双方都有时才强求一致） */
export function episodeNamesSameDate(left: string, right: string): boolean {
  const first = parseEpisodeName(left);
  const second = parseEpisodeName(right);
  if (first.month <= 0 || first.day <= 0 || second.month <= 0 || second.day <= 0)
    return false;
  if (first.month !== second.month || first.day !== second.day) return false;
  return !(first.year > 0 && second.year > 0 && first.year !== second.year);
}

function byEpisode(
  targets: EpisodeNameProfile[],
  source: EpisodeNameProfile,
): number {
  if (source.episode <= 0) return -1;
  let found = -1;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (source.episode !== target.episode) continue;
    if (source.season > 0 && target.season > 0 && source.season !== target.season)
      continue;
    // 双方都带日期却不是同一天：集号证据与日期证据矛盾，该候选弃权
    if (conflictingDate(source, target)) continue;
    if (!compatiblePart(source, target)) continue;
    if (found >= 0) {
      // 同号平手：仅差封装/标签的同集多版本保留第一个；名字实质不同才是真歧义
      if (!sameVersion(targets[found], target)) return -1;
      continue;
    }
    found = i;
  }
  return found;
}

function byExact(targets: EpisodeNameProfile[], source: EpisodeNameProfile): number {
  if (!source.normalized) return -1;
  let found = -1;
  for (let i = 0; i < targets.length; i += 1) {
    if (source.normalized !== targets[i].normalized) continue;
    if (found >= 0) return -1;
    found = i;
  }
  return found;
}

function bySimilarity(
  targets: EpisodeNameProfile[],
  source: EpisodeNameProfile,
): number {
  if (source.similarityName.length < 2) return -1;
  let best = 0;
  let second = 0;
  let bestIndex = -1;
  for (let i = 0; i < targets.length; i += 1) {
    if (conflictsWith(source, targets[i])) continue;
    const score = diceBigram(source.similarityName, targets[i].similarityName);
    if (score > best) {
      second = best;
      best = score;
      bestIndex = i;
    } else if (score > second) {
      second = score;
    }
  }
  return bestIndex >= 0 && best >= 0.72 && best - second >= 0.12 ? bestIndex : -1;
}

function byDate(targets: EpisodeNameProfile[], source: EpisodeNameProfile): number {
  if (source.month <= 0 || source.day <= 0) return -1;
  let found = -1;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (source.month !== target.month || source.day !== target.day) continue;
    if (source.year > 0 && target.year > 0 && source.year !== target.year) continue;
    if (!compatiblePart(source, target)) continue;
    if (found >= 0) {
      if (!sameVersion(targets[found], target)) return -1;
      continue;
    }
    found = i;
  }
  return found;
}

/**
 * 名称版匹配（集数 → 精确 → 相似度 → 日期），返回命中下标，-1 表示无匹配。
 * 移植自手机端 matchNames，去掉下标对位与单集兜底（本站调用方从不传历史下标）。
 */
export function matchEpisodeNames(names: string[], sourceName: string): number {
  if (!names || names.length === 0) return -1;
  const source = parseEpisodeName(sourceName);
  const targets = names.map((name) => parseEpisodeName(name));

  let index = byEpisode(targets, source);
  if (index >= 0) return index;
  index = byExact(targets, source);
  if (index >= 0) return index;
  index = bySimilarity(targets, source);
  if (index >= 0) return index;
  return byDate(targets, source);
}

/** 纯集名匹配（精确 → 相似度，带冲突守卫），集名里的「第N期」不是集号证据 */
export function matchEpisodeLabel(names: string[], label: string): number {
  if (!names || names.length === 0) return -1;
  const source = parseEpisodeName(label);
  const targets = names.map((name) => parseEpisodeName(name));

  const index = byExact(targets, source);
  if (index >= 0) return index;
  return bySimilarity(targets, source);
}

/** 剥噪后的标题相似度（dice bigram），供身份比对复用 */
export function episodeNameSimilarity(left: string, right: string): number {
  return diceBigram(
    parseEpisodeName(left).similarityName,
    parseEpisodeName(right).similarityName,
  );
}

export function normalizeEpisodeNameText(name: string | null | undefined): string {
  return normalizeName(stripDisplayPrefix((name == null ? '' : name).trim()));
}
