import { API_BASE_URL } from './api';

type Source = 'boundary' | 'window' | 'unhandledrejection' | 'query' | 'chunk';

const RELEASE: string = import.meta.env.VITE_RELEASE ?? 'dev';
const MAX_REPORTS_PER_PAGE = 20;
const reported = new Set<string>();

/**
 * Sends a browser crash to the API (POST /client-errors), which forwards it to Sentry.
 * Same-origin, so the CSP stays `connect-src 'self'`. Only the pathname is sent: query
 * strings can carry reset and invite tokens. Each distinct error is sent once per page load.
 */
export function reportError(source: Source, error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  const key = `${source}:${err.message}`;
  if (reported.has(key) || reported.size >= MAX_REPORTS_PER_PAGE) return;
  reported.add(key);
  if (import.meta.env.DEV) console.error(`[${source}]`, err);

  const body = JSON.stringify({
    source,
    message: err.message.slice(0, 500) || err.name,
    stack: err.stack?.slice(0, 4000),
    path: window.location.pathname.slice(0, 300),
    release: RELEASE.slice(0, 64),
  });
  // keepalive lets the report finish even when the page is reloading right after.
  fetch(`${API_BASE_URL}/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
}

// ─── Stale chunks after a deploy ────────────────────────────────────────────────
// Each release replaces the hashed files in /assets. A tab opened before the deploy
// still asks for the old chunk names and gets a 404. Reloading fetches the new
// index.html; the timestamp guard stops a reload loop when the asset really is gone.
const RELOAD_KEY = 'hrms_chunk_reload_at';

export function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

/** Reloads once to pick up the new release. Returns false if a reload was just tried. */
export function reloadForNewRelease(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: reloading without a guard could loop, so let the error screen show instead.
    return false;
  }
  window.location.reload();
  return true;
}

/** Catches errors outside React's render tree (event handlers, timers, unawaited promises). */
export function installGlobalErrorHandlers() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewRelease()) event.preventDefault();
  });
  window.addEventListener('error', (event) => {
    // Resource load failures (an <img> 404) have no `error` object and are not crashes.
    if (event.error) reportError('window', event.error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    // Axios rejections are API answers the UI already shows (toast / inline); only report real bugs.
    if ((event.reason as { isAxiosError?: boolean } | undefined)?.isAxiosError) return;
    reportError('unhandledrejection', event.reason);
  });
}
