import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import { useCallback } from 'react';
import { useRepoQuery } from '@/data/useQuery';
import { loadStructure } from './structureService';

/** The structure snapshot with health and attention, re-read after any write. */
export function useStructure(clock: Clock = systemClock) {
  const query = useCallback(
    (repo: Parameters<typeof loadStructure>[0]) => loadStructure(repo, clock),
    [clock],
  );
  return useRepoQuery(query, [clock]);
}
