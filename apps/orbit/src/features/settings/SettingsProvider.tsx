import { useEffect, useState, type ReactNode } from 'react';
import { useRepository } from '@/platform';
import { loadSettings } from './settingsService';

interface Props {
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Reads the settings document once the repository is open and mirrors it
 * into `usePlanPrefs` before any screen plans a day, so the first proposal
 * already uses the user's working window.
 */
export function SettingsProvider({ fallback = null, children }: Props) {
  const repo = useRepository();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadSettings(repo)
      .catch(() => undefined) // defaults stay in place; Settings shows the error on save
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);
  if (!ready) return <>{fallback}</>;
  return <>{children}</>;
}
