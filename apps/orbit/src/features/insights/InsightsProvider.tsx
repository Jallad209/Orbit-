import { systemClock } from '@orbit/core';
import type { Clock } from '@orbit/core';
import type { ReactNode } from 'react';
import { useRepository } from '@/platform';
import { InsightsContext, useInsightsEngine } from './useInsights';

interface Props {
  clock?: Clock;
  children: ReactNode;
}

/** Mounts the shared insight computation for every screen inside the app shell. */
export function InsightsProvider({ clock = systemClock, children }: Props) {
  const repo = useRepository();
  const state = useInsightsEngine(repo, clock);
  return <InsightsContext.Provider value={state}>{children}</InsightsContext.Provider>;
}
