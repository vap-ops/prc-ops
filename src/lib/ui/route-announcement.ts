// The route-loading announcement channel (#980 follow-up).
//
// WHY A STORE AND NOT A CONTEXT: the one region that does the announcing lives
// in the root layout, and the things that write to it are Suspense FALLBACKS
// (loading.tsx) rendered deep in the tree. A context provider would have to wrap
// {children}, so every announcement would re-render the whole app subtree. An
// external store lets the region subscribe as a SIBLING of {children} and
// re-render alone.
//
// WHY NOT THE TOAST PROVIDER'S REGION (features/common/toast-provider.tsx),
// which is also persistent and also polite: its region's children ARE the toast
// items that render the visible pills, so a silent announcement would need a new
// axis on ToastItem; MAX_STACK = 3 drops the OLDEST, so frequent navigation
// announcements would evict a rare and important success/error toast; and toasts
// auto-dismiss on a 4s timer while a loading announcement must clear exactly
// when the boundary unmounts. Separate concerns, separate region.
//
// SCOPE: this announces the PENDING window only — the seconds a route spends on
// its skeleton. It does NOT announce arrival, and nothing else reliably does
// either: Next.js mounts a persistent announcer of its own
// (client/components/app-router-announcer, a shadow-DOM role="alert"), but
// measured live across four client-side navigations it stayed EMPTY on three
// whose document.title had provably changed, and on the fourth spoke
// "สวัสดี คุณ…" — the SA home's <h1>, neither the destination nor the current
// page. Its effect samples document.title when the router tree changes, before
// the title is swapped, then falls through to querySelector("h1"). So arrival
// is an OPEN gap, recorded rather than assumed handled; do not read this file's
// silence on arrival as "the framework has it covered".

export const ROUTE_LOADING_MESSAGE = "กำลังโหลด…";

export interface RouteAnnouncement {
  /** What the region should say; "" means the region is silent. */
  readonly message: string;
  /**
   * Identity of THIS announcement. Every boundary uses the same words, and a
   * live region only speaks on a DOM mutation — so the region keys its child on
   * `seq`, and navigating A → B → C re-announces instead of rendering
   * byte-identical output and going silent from the second navigation on.
   */
  readonly seq: number;
}

const SILENT: RouteAnnouncement = Object.freeze({ message: "", seq: 0 });

/**
 * The server snapshot is a frozen constant, never the live value: module state
 * is shared across requests on the server, so reading the live value would
 * render one user's in-flight navigation into another user's HTML (and mismatch
 * on hydration). Nothing announces during SSR — the writers are effects.
 */
const SERVER_SNAPSHOT: RouteAnnouncement = SILENT;

let snapshot: RouteAnnouncement = SILENT;
let depth = 0;
let seq = 0;

const listeners = new Set<() => void>();

function publish(next: RouteAnnouncement): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Announce that a route-loading boundary is on screen. Returns the release to
 * call when it leaves — designed to be returned straight out of a `useEffect`.
 *
 * Ref-counted: Next.js applies the nearest `loading.tsx`, but a parent segment's
 * boundary can still be mounted when a child's appears, and a boolean would go
 * silent on the first release while the user is still waiting.
 */
export function beginRouteLoading(): () => void {
  depth += 1;
  if (depth === 1) {
    seq += 1;
    publish({ message: ROUTE_LOADING_MESSAGE, seq });
  }

  let released = false;
  return () => {
    // React can invoke a cleanup more than once across Strict Mode / Fast
    // Refresh; an unguarded decrement would underflow the count and silence a
    // boundary that is still on screen.
    if (released) return;
    released = true;
    depth -= 1;
    if (depth === 0) publish({ message: "", seq });
  };
}

export function subscribeRouteAnnouncement(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable reference while nothing changes — the useSyncExternalStore contract. */
export function getRouteAnnouncement(): RouteAnnouncement {
  return snapshot;
}

export function getServerRouteAnnouncement(): RouteAnnouncement {
  return SERVER_SNAPSHOT;
}
