import { useEffect, useState } from 'react';

import {
  getTmdbWatchProgressByMediaKey,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import type { TmdbWatchProgress } from '@/lib/types';

export function useTmdbSeasonProgress(mediaKey: string, season: number) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    items: TmdbWatchProgress[];
    error: boolean;
  }>({ key: '', items: [], error: false });
  const key = `${mediaKey}:${season}`;
  useEffect(
    () =>
      subscribeToDataUpdates('playRecordsUpdated', () =>
        setRevision((value) => value + 1),
      ),
    [],
  );
  useEffect(() => {
    let disposed = false;
    if (!mediaKey) return;
    void getTmdbWatchProgressByMediaKey(mediaKey, season)
      .then((items) => {
        if (!disposed) setState({ key, items, error: false });
      })
      .catch(() => {
        if (!disposed) setState({ key, items: [], error: true });
      });
    return () => {
      disposed = true;
    };
  }, [key, mediaKey, season, revision]);
  return {
    progress: state.key === key ? state.items : [],
    progressError: state.key === key && state.error,
    retryProgress: () => setRevision((value) => value + 1),
  };
}
