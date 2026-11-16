# TMDB 元数据与选季集

豆瓣海报类入口（首页精选、豆瓣分类页、目录收藏卡）与搜索关键词在 TMDB 生效（本地设置或站点 env 默认）时先进 `/subject` 详情页：TMDB 搜索匹配 → 展示剧集详情与季/集网格 → 点集后全源检索并按五层匹配器定位该集 → 跳转播放页。未启用或匹配失败时回退旧的 `/play?title=` 直接搜索起播（搜索页落到源聚合视图），详情页永远提供「直接搜索播放」出口。

## 站点默认与用户本地设置

- TMDB 是**浏览器直连**能力：请求由用户浏览器直接发给 TMDB，不经本站服务器，也不消耗回源预算。配置分两层，**本地设置逐字段覆盖站点默认**：
  - **站点默认**（env，`src/lib/tmdb-site-defaults.server.ts`）：`TMDB_DEFAULT_API_HOST` / `TMDB_DEFAULT_API_KEY` / `TMDB_DEFAULT_IMAGE_HOST`，`TMDB_DEFAULT_ENABLED` 未显式配置时 = 配了 Key 即开。经 `RUNTIME_CONFIG` 与 `/api/server-config` 下发给**所有访问者（含游客）**——这是 browser-direct 设计的固有属性；给不给默认 Key 由站长自行决定。管理后台仍不配置 TMDB（旧版站点级 `TmdbConfig` 由 `configSelfCheck` 自动从存量配置 JSON 清除）。
  - **用户本地设置**（「本地设置 → TMDB」，`src/lib/tmdb-preferences.ts`，localStorage 键 `tmdbSettings`，经 `browser-storage` 访问）：host 去尾斜杠、非 http(s) 归一化为**空串**；空串的语义是「跟随站点默认」，无站点配置时回落官方地址（API `https://api.themoviedb.org/3`，图片 `https://image.tmdb.org/t/p`）。写入口存归一化后的值。`enabled` 只认用户显式布尔：显式关掉后即使站点默认开也不生效；本地 JSON 无该字段时继承站点默认。
- 生效配置由 `resolveEffectiveTmdbSettings()` 合并（`isTmdbClientEnabled()` / `resolveTmdbClientSettings()` / `tmdbImageUrl()` 都走它）；设置面板输入框空串即继承、placeholder 呈现站点默认，「测试」按钮对「草稿合并站点默认」的组合发请求。
- `ApiKey` 两种形态：v4 read access token（`eyJ` 开头，走 `Authorization: Bearer`）与 v3 api_key（附 `api_key` query）。Key 只存在浏览器、只发往 TMDB。
- 跨域：官方 `api.themoviedb.org` 放行 CORS（v4 Bearer 的预检也放行）；自定义镜像 / 反代必须自行支持 CORS，否则在浏览器里统一表现为「无法连接 TMDB」。
- 入口判定 `isTmdbSubjectEntryEnabled()`（`src/lib/subject-navigation.ts`）同步读 localStorage + `window.RUNTIME_CONFIG`：生效配置开关打开且有 Key 才生效，点击时实时判定、改完设置无需刷新。

## 浏览器直连客户端 `src/features/tmdb/lib/tmdb-client.ts`

- `tmdbClientFetchJson`：plain `fetch` + 10s 超时 + 与外部取消 signal 合并；401/403 → `bad-key`（提示「TMDB API Key 无效」），CORS 拦截与断网都是 TypeError → `network`（文案指路「需支持跨域」）。
- `resolveBestTmdbMatch`（豆瓣 → TMDB 两轮搜索）与 `fetchTmdbShowDetail` / `fetchTmdbSeasonDetail` / `fetchTmdbMovieDetail` 的打分与响应形状校验与旧服务端版一致；成功结果存模块级会话 `Map`（返回上一页不重打，无 TTL，刷新页面重置）。
- `searchTmdbMulti(Smart)`：搜索页 TMDB 视图用，`/search/multi` 一次拿 tv+movie（person 结果过滤掉，web 无演员页），强制走网络不进会话缓存；原词空结果时剥季标记重搜一轮（对齐手机版 `fetchSearchMultiSmart`）。
- 图片**直连**图片 host（`tmdbImageUrl()`，`<img>` 加载不受 CORS 限制），host 取生效配置（本地空串继承站点默认）。

## 匹配链路

- **豆瓣 → TMDB**（`src/features/tmdb/lib/resolve.ts` 纯函数，浏览器 resolve 用）：先按传入 type 搜、不过线再换另一类型搜；**搜索不带年份过滤**（豆瓣按季建条目，季年份 ≠ TMDB 首播年，硬过滤会把 S2+ 滤成 0 结果），消歧交给打分：名称精确 +80 / original_name +70 / 年份差 ≤1 +10、≤4 +2、>4 -15，阈值 60。
- **初始季推断**：标题季标记（`parseSeasonMarker`，认「第X季/第X部/S4/Part/中文数字/尾部裸季号」）→ 豆瓣年份唯一等于某季首播年 → 最新有集季。
- **TMDB 集 → 源内集**（`src/features/tmdb/lib/source-episode-match.ts` + 引擎 `episode-name-matcher.ts`，完整移植手机端判定链，纯客户端执行）：条目身份（`normalizeWorkTitle` 相等或关键词为前缀，防衍生剧）→ `episode_groups` 分组换算（复用 `src/lib/episode-groups.ts`，至少一个组标签能读出季号才信任）→ ① 播映日期等值 → 季门控（源标题季 ≠ 目标季仅日期证据有效）→ ② S/E 坐标等值 → ③ 本季相对编号（连播特征 `size ≥ prior+ep 且 > seasonEpisodeCount` 时跳过）→ ④ 集名相似度（dice ≥0.72 且领先次名 ≥0.12）→ ⑤ 全剧绝对编号（只收无季标条目）。排序：命中 > 缺集 > 其他季，同类按年份 ±1 匹配 > 未知 > 不符（排序不过滤）。
- 源检索关键词用 `strippedTitle`（剥季标记后的剧名），复用 `/api/search` 聚合接口，**不要另造搜索链路**。
- 选定源与集后：`savePlayIntent({ source, id, episodeIndex, resumeTime: 0 })`（`src/lib/play-intent.ts` 的一次性意图，播放页历史恢复会优先消费并压过播放记录）→ 跳 `/play?source=&id=&title=&stitle=&directStart=true`。不要用 URL 参数传集号——刷新会重放且绕过分组换算。

## TMDB 坐标进度

- 原有 `play_records` 仍以源与条目存继续观看，`watch_history` 与观看统计不变；额外的 `tmdb_watch_progress` 按 **用户 + mediaKey + season + episode** 保存每集进度，`mediaKey` 为 `tv/95842` / `movie/399566`，电影固定第 0 季第 1 集。进度单位为秒，保存最近一次播放的源、条目与源内集序号，用于找回作品身份。
- `/subject` 选集把坐标附在一次性 `play-intent` 中，仍不把选集指令写入 URL。播放器在后台按当前实际源与集清单复用集匹配器反查坐标；换集、线路变更和详情刷新会重新定位，旧请求取消后不回写。直进播放先读该源最近的坐标以找回作品，再按当前清单重新匹配；无历史则复用标题匹配。源数组下标不能直接当作 TMDB 集号，连播源须换算此前季的集数。
- 坐标匹配不阻塞原有起播和续播。TMDB 未启用、匹配失败或一集对应多个坐标时，只保存原有播放记录；换源只有已确认同一集时才携带坐标提示，新源仍重新核对。
- 进度仍走 `/api/playrecords` 原写入出口，附带的 `tmdbCoordinate` 须与本次源、条目和集索引一致。两份记录在同一数据库事务保存，坐标按进度采集时间防止迟到重试覆盖新值，不用 `MAX(position)`，以保留重新播放时的真实进度。
- `/api/tmdb/history` 只读当前登录用户的坐标：`mediaKey + season + afterEpisode` 按集号游标分页，`source + id` 返回该源最近的一个坐标作为作品提示；浏览器 helper 负责逐页读取一季。此 API 不代理 TMDB 请求、不保存用户 Key。删除继续观看或观看历史不删除坐标，删除账号一并清理。

## 页面与入口

- 页面：`src/app/subject/`（`AuthenticatedRoute` 挂 layout），客户端组件在 `src/features/tmdb/components/`。登录后的页面外壳由 `SubjectPageClient` 与 `SubjectSkeleton` 自带 `PageLayout`（`AuthenticatedRoute` 只在门禁态包外壳），漏了会整页无顶栏、无返回按钮。骨架与真实组件共用 `subject-layout.ts` 布局常量；TMDB 请求全部由浏览器直发（`tmdb-client.ts`），图片直连图片 host（`tmdbImageUrl()`）。
- `/subject` 两种进入方式：豆瓣海报走标题匹配（`resolveBestTmdbMatch`）；搜索 TMDB 结果带 **`tmdbId` 直进**（跳过匹配按 id 拉详情），关键词季标记解析出的季号经 **`season`** 参数传给初始季推断（`inferInitialSeason` 取标题季标记与 season 参数的较大者）。
- 源匹配面板（`SourceMatchPanel`）：首个命中源 5s 倒计时自动播放，任意点击/关闭打断。
- 海报入口集中在 `usePosterPlay` 与 `VideoCard` 的 `playsByTitle` 分支（判定函数 `isTmdbSubjectEntryEnabled()`，读生效配置）：启用时跳 `/subject`（本地观看记录的「继续观看」由详情页提供，入口不再短路直跳）；**聚合搜索卡的源结果分支不变**，仍直接进播放页。
- **搜索入口**（对齐手机版搜索页）：TMDB 生效时 `/search?q=` 默认渲染 TMDB 结果整页（`TmdbSearchResults`，见[源站与搜索](sources-search.md#搜索)）；空/出错自动落到源聚合，`view=source` 强制源视图。与手机版的有意偏差：**不做豆瓣层**（本站豆瓣体系只有分类浏览、无关键词搜索接口）、**过滤 person 结果**（无演员页）、**不做单结果自动进详情**（web 以 URL 驱动，列表更可预期）。

## 多画质结论

苹果 CMS 协议除线路（`vod_play_from` 按 `$$$` 拆）外**没有原生多画质字段**。多画质的两个现实来源本站均已支持：m3u8 master 多码率变体（画质菜单 + ABR + 失败降档，见[播放](playback.md#容错与换源)）与把画质当线路发布的站（已被 `playback_lines` 覆盖，并参与源内线路自动轮换）。不需要协议层增强。
