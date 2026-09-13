const KEY = 'orbit-first-run-done';

/** Desktop shows the welcome flow once per install; the flag lives in localStorage. */
export function isFirstRunDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true;
  }
}

export function markFirstRunDone(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: the flow simply shows again */
  }
}

export function resetFirstRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
