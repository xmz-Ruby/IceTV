# TMDB 元数据与选季集

豆瓣海报类入口（首页精选、豆瓣分类页、目录收藏卡）在用户本地启用 TMDB 时先进 `/subject` 详情页：TMDB 搜索匹配 → 展示剧集详情与季/集网格 → 点集后全源检索并按五层匹配器定位该集 → 跳转播放页。未启用或匹配失败时回退旧的 `/play?title=` 直接搜索起播，详情页永远提供「直接搜索播放」出口。

## 用户本地设置（无站点级配置）

- TMDB 是**用户级能力**：每个用户在「本地设置 → TMDB」自行开启并填写 API Key，浏览器**直连** TMDB，不经本站服务器。管理后台与环境变量均不配置 TMDB（旧版站点级 `TmdbConfig` 由 `configSelfCheck` 自动从存量配置 JSON 清除）。
- 设置 helper 在 `src/lib/tmdb-preferences.ts`（localStorage 键 `tmdbSettings`，经 `browser-storage` 访问）：host 去尾斜杠、非 http(s) 回落默认（API `https://api.themoviedb.org/3`，图片 `https://image.tmdb.org/t/p`）；写入口存归一化后的值，默认关闭。
- `ApiKey` 两种形态：v4 read access token（`eyJ` 开头，走 `Authorization: Bearer`）与 v3 api_key（附 `api_key` query）。**Key 只存在用户自己的浏览器、只发往 TMDB**——这是该设置的设计前提，不是泄露。
- 跨域：官方 `api.themoviedb.org` 放行 CORS（v4 Bearer 的预检也放行）；自定义镜像 / 反代必须自行支持 CORS，否则在浏览器里统一表现为「无法连接 TMDB」。
- 入口判定 `isTmdbSubjectEntryEnabled()`（`src/lib/subject-navigation.ts`）同步读 localStorage：开关打开且填了 Key 才生效，点击时实时判定、改完设置无需刷新。

## 浏览器直连客户端 `src/features/tmdb/lib/tmdb-client.ts`

- `tmdbClientFetchJson`：plain `fetch` + 10s 超时 + 与外部取消 signal 合并；401/403 → `bad-key`（提示「TMDB API Key 无效」），CORS 拦截与断网都是 TypeError → `network`（文案指路「需支持跨域」）。
- `resolveBestTmdbMatch`（豆瓣 → TMDB 两轮搜索）与 `fetchTmdbShowDetail` / `fetchTmdbSeasonDetail` / `fetchTmdbMovieDetail` 的打分与响应形状校验与旧服务端版一致；成功结果存模块级会话 `Map`（返回上一页不重打，无 TTL，刷新页面重置）。
- 图片**直连**图片 host（`tmdbImageUrl()`，`<img>` 加载不受 CORS 限制），host 可在本地设置换镜像。

## 匹配链路

- **豆瓣 → TMDB**（`src/features/tmdb/lib/resolve.ts` 纯函数，浏览器 resolve 用）：先按传入 type 搜、不过线再换另一类型搜；**搜索不带年份过滤**（豆瓣按季建条目，季年份 ≠ TMDB 首播年，硬过滤会把 S2+ 滤成 0 结果），消歧交给打分：名称精确 +80 / original_name +70 / 年份差 ≤1 +10、≤4 +2、>4 -15，阈值 60。
- **初始季推断**：标题季标记（`parseSeasonMarker`，认「第X季/第X部/S4/Part/中文数字/尾部裸季号」）→ 豆瓣年份唯一等于某季首播年 → 最新有集季。
- **TMDB 集 → 源内集**（`src/features/tmdb/lib/source-episode-match.ts` + 引擎 `episode-name-matcher.ts`，完整移植手机端判定链，纯客户端执行）：条目身份（`normalizeWorkTitle` 相等或关键词为前缀，防衍生剧）→ `episode_groups` 分组换算（复用 `src/lib/episode-groups.ts`，至少一个组标签能读出季号才信任）→ ① 播映日期等值 → 季门控（源标题季 ≠ 目标季仅日期证据有效）→ ② S/E 坐标等值 → ③ 本季相对编号（连播特征 `size ≥ prior+ep 且 > seasonEpisodeCount` 时跳过）→ ④ 集名相似度（dice ≥0.72 且领先次名 ≥0.12）→ ⑤ 全剧绝对编号（只收无季标条目）。排序：命中 > 缺集 > 其他季，同类按年份 ±1 匹配 > 未知 > 不符（排序不过滤）。
- 源检索关键词用 `strippedTitle`（剥季标记后的剧名），复用 `/api/search` 聚合接口，**不要另造搜索链路**。
- 选定源与集后：`savePlayIntent({ source, id, episodeIndex, resumeTime: 0 })`（`src/lib/play-intent.ts` 的一次性意图，播放页历史恢复会优先消费并压过播放记录）→ 跳 `/play?source=&id=&title=&stitle=&directStart=true`。不要用 URL 参数传集号——刷新会重放且绕过分组换算。

## 页面与入口

- 页面：`src/app/subject/`（`AuthenticatedRoute` 挂 layout），客户端组件在 `src/features/tmdb/components/`。登录后的页面外壳由 `SubjectPageClient` 与 `SubjectSkeleton` 自带 `PageLayout`（`AuthenticatedRoute` 只在门禁态包外壳），漏了会整页无顶栏、无返回按钮。骨架与真实组件共用 `subject-layout.ts` 布局常量；TMDB 请求全部由浏览器直发（`tmdb-client.ts`），图片直连图片 host（`tmdbImageUrl()`）。
- 源匹配面板（`SourceMatchPanel`）：首个命中源 5s 倒计时自动播放，任意点击/关闭打断。
- 入口改造集中在 `usePosterPlay` 与 `VideoCard` 的 `playsByTitle` 分支（判定函数 `isTmdbSubjectEntryEnabled()`，读用户本地设置）：启用时跳 `/subject`（本地观看记录的「继续观看」由详情页提供，入口不再短路直跳）；**聚合搜索卡分支不变**，仍直接进播放页。

## 多画质结论

苹果 CMS 协议除线路（`vod_play_from` 按 `$$$` 拆）外**没有原生多画质字段**。多画质的两个现实来源本站均已支持：m3u8 master 多码率变体（画质菜单 + ABR + 失败降档，见[播放](playback.md#容错与换源)）与把画质当线路发布的站（已被 `playback_lines` 覆盖，并参与源内线路自动轮换）。不需要协议层增强。
