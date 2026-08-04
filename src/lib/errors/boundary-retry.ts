// Recurrence memory for the app's error boundaries (UX-audit G1, F-012).
// Client-safe leaf module — no server imports, usable from error.tsx AND
// global-error.tsx (which renders with nothing above it alive).
//
// Key shape (G1 review): client render crashes carry NO Next digest, so a
// name-only key (`err-retry:TypeError`) would collide across unrelated
// crashes app-wide — one retry anywhere would deny retry to every later
// crash sharing the name. The pathname scopes it: recurrence means "THIS
// error class on THIS route was already retried".
//
// TTL (G1 review): nothing can observe a SUCCESSFUL recovery (the boundary
// unmounts silently), so a recorded retry expires instead — a crash hours
// after a retry that worked gets its honest first-occurrence retry back.

const PREFIX = "err-retry:";
const TTL_MS = 5 * 60_000;

export function boundaryRetryKey(error: { digest?: string; name: string }): string {
  const route = typeof window !== "undefined" ? window.location.pathname : "";
  return `${PREFIX}${error.digest ?? error.name}:${route}`;
}

/** True when a retry for this key was recorded within the TTL. */
export function hasRecentRetry(key: string): boolean {
  try {
    const ts = Number(sessionStorage.getItem(key) ?? "0");
    return ts > 0 && Date.now() - ts < TTL_MS;
  } catch {
    return false;
  }
}

/** Record a retry attempt. A failed write must never block the reset itself. */
export function recordRetry(key: string): void {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // A failed write only means the remounted boundary cannot know a retry
    // happened — one extra optimistic retry, never a blocked one.
  }
}
