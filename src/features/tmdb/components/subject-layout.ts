// 详情页剧集网格与骨架共用的布局常量（改版式时两处同步）
export const EPISODE_GRID_CLASS =
  'grid grid-cols-2 gap-x-3 gap-y-4 min-[480px]:grid-cols-3 sm:grid-cols-4 sm:gap-x-4 lg:grid-cols-5 xl:grid-cols-6';

// 剧照 16:9；骨架用同一比例占位
export const EPISODE_STILL_ASPECT_CLASS = 'aspect-video';

export const SEASON_CHIP_MAX = 12;

export function formatEpisodeAirDate(airDate: string | null): string {
  if (!airDate) return '';
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(airDate);
  if (!parsed) return airDate;
  return `${parsed[1]}-${parsed[2]}-${parsed[3]}`;
}

export function isEpisodeAired(airDate: string | null): boolean {
  if (!airDate) return true;
  return airDate <= new Date().toISOString().slice(0, 10);
}
