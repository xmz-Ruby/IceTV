// TMDB 默认 host 常量的唯一出处：runtime-config（站点默认的兜底）与本地设置 helper 共用。
// 单独成叶子模块是因为 runtime-config 与 tmdb-preferences 会互相引用，常量放任何一边都会成环。
export const DEFAULT_TMDB_API_HOST = 'https://api.themoviedb.org/3';
export const DEFAULT_TMDB_IMAGE_HOST = 'https://image.tmdb.org/t/p';
