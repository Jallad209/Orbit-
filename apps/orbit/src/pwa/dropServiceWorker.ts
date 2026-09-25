/**
 * Remove any service worker and its precache from this origin.
 *
 * The desktop shell serves the bundle from disk, so a worker there is pure downside: the one
 * registered by an earlier release keeps answering with that release's HTML and scripts, and
 * after an upgrade the new Rust side then receives calls from the old frontend. Orbit no
 * longer registers a worker outside the web app, and this clears the ones already installed.
 *
 * It is best effort by design. The shell deletes the worker's storage when the app version
 * changes, which is the only thing that can help when the stale worker is already serving the
 * page; this runs afterwards, for profiles where that deletion could not complete.
 */
export async function dropServiceWorker(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    }
    if ('caches' in globalThis) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // A locked-down webview may refuse either call; the shell-side deletion is the real fix.
  }
}
