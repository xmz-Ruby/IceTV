'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { PAGE_CONTAINER_CLASS } from '@/components/page-container';
import Spinner from '@/components/Spinner';
import { parseSeasonMarker } from '@/features/tmdb/lib/resolve';
import {
  type TmdbMultiSearchItem,
  describeTmdbClientError,
  resolveTmdbClientSettings,
  searchTmdbMultiSmart,
} from '@/features/tmdb/lib/tmdb-client';
import { tmdbImageUrl } from '@/features/tmdb/lib/tmdb-image-url';
import { buildSubjectPageUrl } from '@/lib/subject-navigation';

interface TmdbSearchResultsProps {
  query: string;
  // 空结果/请求失败时自动切源聚合；带文案时父级顺带给轻提示，手动点击不带
  onFallbackToSource: (notice?: string) => void;
}

function formatItemMeta(item: TmdbMultiSearchItem): string {
  const parts = [
    (item.first_air_date || '').slice(0, 4),
    item.mediaType === 'tv' ? '剧集' : '电影',
  ];
  if (item.vote_average > 0) {
    parts.push(`★ ${item.vote_average.toFixed(1)}`);
  }
  return parts.filter(Boolean).join(' · ');
}

// 搜索页 TMDB 整页结果（对齐手机版搜索页）：multi 直连搜索，点结果进 /subject 选季集；
// 底部常驻「在全部片源中搜索」。未启用时父级不会渲染本组件。
export function TmdbSearchResults({
  query,
  onFallbackToSource,
}: TmdbSearchResultsProps) {
  const router = useRouter();
  const [items, setItems] = useState<TmdbMultiSearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const fallbackFiredRef = useRef('');

  useEffect(() => {
    const controller = new AbortController();
    fallbackFiredRef.current = '';
    setLoading(true);
    setItems([]);

    const settings = resolveTmdbClientSettings();
    if (!settings) {
      onFallbackToSource('未启用 TMDB，已切换到片源搜索');
      return () => controller.abort();
    }

    searchTmdbMultiSmart(settings, query, controller.signal)
      .then(({ items: results }) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (results.length === 0) {
          if (fallbackFiredRef.current !== query) {
            fallbackFiredRef.current = query;
            onFallbackToSource('TMDB 未找到相关内容，已切换到片源搜索');
          }
          return;
        }
        setItems(results);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (fallbackFiredRef.current !== query) {
          fallbackFiredRef.current = query;
          onFallbackToSource(
            `${describeTmdbClientError(error, 'TMDB 搜索失败')}，已切换到片源搜索`,
          );
        }
      });

    return () => controller.abort();
    // onFallbackToSource 需由父级 useCallback 稳定，避免查询期间重复发起搜索
  }, [query, onFallbackToSource]);

  const openItem = (item: TmdbMultiSearchItem) => {
    router.push(
      buildSubjectPageUrl({
        title: item.name,
        year: (item.first_air_date || '').slice(0, 4),
        type: item.mediaType,
        tmdbId: item.id,
        // 关键词里的季标记（「XX 第二季」）转成初始季提示，标题本身用 TMDB 名称
        season: parseSeasonMarker(query),
      }),
    );
  };

  return (
    <div className={`${PAGE_CONTAINER_CLASS} pb-8 pt-4 sm:pt-6`}>
      <div className='mb-3 flex items-baseline justify-between gap-3'>
        <h2 className='text-sm font-medium text-gray-500 dark:text-gray-400'>
          TMDB · 「{query}」
          {!loading && items.length > 0 ? ` ${items.length} 个结果` : ''}
        </h2>
      </div>

      {loading && (
        <div className='flex items-center justify-center gap-2 py-16 text-sm text-gray-500 dark:text-gray-400'>
          <Spinner className='h-4 w-4' />
          正在搜索 TMDB...
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className='space-y-1.5'>
          {items.map((item) => (
            <li key={`${item.mediaType}-${item.id}`}>
              <button
                type='button'
                onClick={() => openItem(item)}
                className='flex w-full gap-3 rounded-xl p-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.06]'
              >
                {item.poster_path ? (
                  <img
                    src={tmdbImageUrl(item.poster_path, 'w185')}
                    alt={item.name}
                    loading='lazy'
                    className='aspect-[2/3] w-[72px] shrink-0 rounded-lg bg-gray-200 object-cover dark:bg-white/10 sm:w-[88px]'
                  />
                ) : (
                  <div className='aspect-[2/3] w-[72px] shrink-0 rounded-lg bg-gray-200 dark:bg-white/10 sm:w-[88px]' />
                )}
                <div className='min-w-0 flex-1 py-0.5'>
                  <p className='truncate text-[15px] font-medium text-gray-900 dark:text-gray-100'>
                    {item.name}
                    {item.original_name && item.original_name !== item.name && (
                      <span className='ml-2 text-xs font-normal text-gray-400 dark:text-gray-500'>
                        {item.original_name}
                      </span>
                    )}
                  </p>
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    {formatItemMeta(item)}
                  </p>
                  {item.overview && (
                    <p className='mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-gray-500 dark:text-gray-400'>
                      {item.overview}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type='button'
        onClick={() => onFallbackToSource()}
        className='mt-5 w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/[0.06]'
      >
        在全部片源中搜索
      </button>
    </div>
  );
}
