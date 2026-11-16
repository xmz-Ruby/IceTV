import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import { NO_STORE_HEADERS } from '@/lib/http-cache';
import {
  isValidTmdbMediaKey,
  TMDB_WATCH_PROGRESS_PAGE_SIZE,
} from '@/lib/tmdb-watch-history';

export const runtime = 'nodejs';

function parseSeason(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const season = Number(value);
  return Number.isSafeInteger(season) && season <= 999 ? season : null;
}

export async function GET(request: NextRequest) {
  try {
    const guardResult = await requireActiveUser(request);
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { searchParams } = new URL(request.url);
    const mediaKey = searchParams.get('mediaKey');
    const seasonParam = searchParams.get('season');
    if (mediaKey !== null || seasonParam !== null) {
      const season = parseSeason(seasonParam);
      const afterParam = searchParams.get('afterEpisode');
      const afterEpisode =
        afterParam === null
          ? 0
          : /^\d+$/.test(afterParam)
            ? Number(afterParam)
            : NaN;
      if (
        !mediaKey ||
        !isValidTmdbMediaKey(mediaKey) ||
        season === null ||
        (mediaKey.startsWith('movie/') && season !== 0) ||
        !Number.isSafeInteger(afterEpisode) ||
        afterEpisode < 0 ||
        afterEpisode > 100_000
      ) {
        return NextResponse.json(
          { error: 'Invalid TMDB coordinate' },
          { status: 400 },
        );
      }
      const rows = await db.getTmdbWatchProgressByMediaKey(
        guardResult.username,
        mediaKey,
        season,
        afterEpisode,
      );
      const items = rows.slice(0, TMDB_WATCH_PROGRESS_PAGE_SIZE);
      return NextResponse.json(
        {
          items,
          nextEpisode:
            rows.length > items.length ? items[items.length - 1].episode : null,
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const source = searchParams.get('source') || '';
    const videoId = searchParams.get('id') || '';
    if (
      !source.trim() ||
      source.length > 191 ||
      !videoId.trim() ||
      videoId.length > 255
    ) {
      return NextResponse.json(
        { error: 'Invalid source coordinate' },
        { status: 400 },
      );
    }
    const rows = await db.getTmdbWatchProgressBySource(
      guardResult.username,
      source,
      videoId,
    );
    return NextResponse.json(rows, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('获取 TMDB 观看坐标失败', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
