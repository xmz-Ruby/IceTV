# TMDB 元数据与选季集

豆瓣海报类入口（首页精选、豆瓣分类页、目录收藏卡）在 TMDB 启用时先进 `/subject` 详情页：TMDB 搜索匹配 → 展示剧集详情与季/集网格 → 点集后全源检索并按五层匹配器定位该集 → 跳转播放页。未启用或匹配失败时回退旧的 `/play?title=` 直接搜索起播，详情页永远提供「直接搜索播放」出口。

## 配置

- 真相源是 `admin_config` JSON 的 `TmdbConfig`（`AdminConfig.TmdbConfig`，类型 `TmdbSettings`），后台「站点 → TMDB」维护；env `TMDB_ENABLED` / `TMDB_API_HOST` / `TMDB_API_KEY` / `TMDB_IMAGE_HOST` 只作首次初始化默认值。
- 归一化入口在 `src/lib/tmdb-settings.ts`（`normalizeTmdbSettings` / `isTmdbSettingsEnabled`）：host 去尾斜杠、非法值回落默认（API `https://api.themoviedb.org/3`，图片 `https://image.tmdb.org/t/p`）。
- `ApiKey` 支持两种形态：v4 read access token（`eyJ` 开头，走 `Authorization: Bearer`）与 v3 api_key（附 `api_key` query）。**Key 只存在服务端**，`getPublicConfig()` 仅暴露 `TmdbEnabled: boolean`（经 `/api/server-config` 与根布局内联的 `window.RUNTIME_CONFIG.TMDB_ENABLED` 下发，入口点击用它决定跳 `/subject` 还是 `/play`）。

## API 路由（全部 `requireActiveUser`）

| 路由 | 说明 |
| --- | --- |
| `/api/tmdb/resolve?title=&year=&type=` | 搜索 + 打分，返回 `{ status: ok\|disabled\|no-match\|error, match?, strippedTitle }` |
| `/api/tmdb/tv?id=` / `/api/tmdb/movie?id=` | 详情（含 seasons） |
| `/api/tmdb/season?id=&season=` | 季集列表 |
| `/api/tmdb-image/[size]/[file]` | 图片代理（host 取 ImageHost；只放行 size 段与 TMDB 文件名段，8MB 限流转发） |

- 数据路由走 quota kind `tmdb-data`（120/min），图片走 `tmdb-image`（480/min），定义在 `src/lib/server-proxy-guard.ts`。
- 回源统一 `fetchUpstream()` + 10s 超时 + `readJsonLimited()`，实现在 `src/features/tmdb/lib/tmdb.server.ts`；401/403 映射 `bad-key`（对用户提示「TMDB API Key 无效」）。
- 共享缓存（`src/features/tmdb/lib/tmdb-cache.ts`，键含版本号，改响应结构时升版）：`tmdb-resolve-v1`（30m/24h，不缓存 error）、`tmdb-tv-v1` 与 `tmdb-movie-v1`（6h/24h）、`tmdb-season-v1`（30m/6h）。

## 匹配链路

- **豆瓣 → TMDB**（`src/features/tmdb/lib/resolve.ts` 纯函数，服务端 resolve 路由用）：先按传入 type 搜、不过线再换另一类型搜；**搜索不带年份过滤**（豆瓣按季建条目，季年份 ≠ TMDB 首播年，硬过滤会把 S2+ 滤成 0 结果），消歧交给打分：名称精确 +80 / original_name +70 / 年份差 ≤1 +10、≤4 +2、>4 -15，阈值 60。
- **初始季推断**：标题季标记（`parseSeasonMarker`，认「第X季/第X部/S4/Part/中文数字/尾部裸季号」）→ 豆瓣年份唯一等于某季首播年 → 最新有集季。
- **TMDB 集 → 源内集**（`src/features/tmdb/lib/source-episode-match.ts` + 引擎 `episode-name-matcher.ts`，完整移植手机端判定链，纯客户端执行）：条目身份（`normalizeWorkTitle` 相等或关键词为前缀，防衍生剧）→ `episode_groups` 分组换算（复用 `src/lib/episode-groups.ts`，至少一个组标签能读出季号才信任）→ ① 播映日期等值 → 季门控（源标题季 ≠ 目标季仅日期证据有效）→ ② S/E 坐标等值 → ③ 本季相对编号（连播特征 `size ≥ prior+ep 且 > seasonEpisodeCount` 时跳过）→ ④ 集名相似度（dice ≥0.72 且领先次名 ≥0.12）→ ⑤ 全剧绝对编号（只收无季标条目）。排序：命中 > 缺集 > 其他季，同类按年份 ±1 匹配 > 未知 > 不符（排序不过滤）。
- 源检索关键词用 `strippedTitle`（剥季标记后的剧名），复用 `/api/search` 聚合接口，**不要另造搜索链路**。
- 选定源与集后：`savePlayIntent({ source, id, episodeIndex, resumeTime: 0 })`（`src/lib/play-intent.ts` 的一次性意图，播放页历史恢复会优先消费并压过播放记录）→ 跳 `/play?source=&id=&title=&stitle=&directStart=true`。不要用 URL 参数传集号——刷新会重放且绕过分组换算。

## 页面与入口

- 页面：`src/app/subject/`（`AuthenticatedRoute` 挂 layout），客户端组件在 `src/features/tmdb/components/`。骨架与真实组件共用 `subject-layout.ts` 布局常量；TMDB 图片一律经 `/api/tmdb-image/`（`tmdbImageUrl()`），不直连图片 host。
- 源匹配面板（`SourceMatchPanel`）：首个命中源 5s 倒计时自动播放，任意点击/关闭打断。
- 入口改造集中在 `usePosterPlay` 与 `VideoCard` 的 `playsByTitle` 分支（判定函数 `isTmdbSubjectEntryEnabled()`，`src/lib/subject-navigation.ts`）：启用时跳 `/subject`（本地观看记录的「继续观看」由详情页提供，入口不再短路直跳）；**聚合搜索卡分支不变**，仍直接进播放页。

## 多画质结论

苹果 CMS 协议除线路（`vod_play_from` 按 `$$$` 拆）外**没有原生多画质字段**。多画质的两个现实来源本站均已支持：m3u8 master 多码率变体（画质菜单 + ABR + 失败降档，见[播放](playback.md#容错与换源)）与把画质当线路发布的站（已被 `playback_lines` 覆盖，并参与源内线路自动轮换）。不需要协议层增强。
