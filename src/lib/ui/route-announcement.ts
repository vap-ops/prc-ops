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
//
// ── ARRIVAL (added after #983, measured before it was designed) ──────────────
// Instrumented on a live dev server, one client-side navigation:
//
//   +1073ms  title-node-REMOVED   ""                    ← head briefly has NO title
//   +1074ms  pathname-changed     /projects
//   +1094ms  loading-region       "กำลังโหลด…"
//   +1100ms  title-node-ADDED     "โครงการ — PRC Ops"
//   +1736ms  loading-region       ""                    ← content actually arrives
//
// Three facts from that, each load-bearing below:
//   ① Next REPLACES the <title> NODE rather than mutating its text, so
//      document.title is empty for ~3–170ms per navigation. That gap is what the
//      framework's announcer samples in — the root cause of it speaking the
//      wrong thing. NOTE the split, because this file's value is that
//      distinction: the gap and the wrong output were both MEASURED, but the
//      causal link between them is read off that file's source and is an
//      INFERENCE — the announcer's own read was never instrumented.
//   ② The <h1> is NOT a usable fallback: on 4 of 5 sampled pages it reads
//      "สวัสดี คุณ<ชื่อ>", the greeting — announcing it reads the user their own
//      name on arrival. We never fall back to it; a page with no title of its
//      own stays SILENT.
//   ③ The title is correct 640–930ms BEFORE the content arrives, so arrival must
//      DEFER while a loading boundary is open — otherwise the user is told they
//      have landed on a page that is still a skeleton.

export const ROUTE_LOADING_MESSAGE = "กำลังโหลด…";

import { APP_NAME, APP_TITLE_SUFFIX } from "@/lib/ui/app-title";

/**
 * The destination name to announce, or "" for silence.
 *
 * Silence — never a best guess — for the two cases that produce a misleading
 * announcement: the empty title inside Next's node-swap gap, and a page that
 * set no title (measured on /contacts: title "PRC Ops", no <h1> at all).
 */
export function pageNameFromTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed === "") return "";
  // Match the TRIMMED suffix: the trim() above shortens " — PRC Ops" below the
  // full suffix's length, so a plain endsWith misses it and a page with
  // `title: ""` would be read a dangling em dash followed by the app name.
  const suffix = APP_TITLE_SUFFIX.trimStart();
  const name = trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length).trim() : trimmed;
  // One check, deliberately at the END: it catches both the bare default (a page
  // that set no title) and a title that was ONLY the suffix. Testing for the
  // default up front as well made the two guards mutually redundant, so neither
  // was pinned and one was dead — a mutation on each survived.
  // The bare app name is what a page with no title of its own renders (the
  // template's `default`), and it names no page — so it is silence, not an
  // announcement. Read from the SSOT for the same reason as the suffix.
  return name === APP_NAME ? "" : name;
}

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

/**
 * A destination that resolved while a loading boundary was still open, waiting
 * for that boundary to close. Holds only the LAST one: a redirect chain, or a
 * second tap mid-wait, can change the title more than once behind one skeleton,
 * and the user arrives exactly once.
 */
let pendingArrival = "";

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
 *
 * The count is not purely protective — `seq` advances only on the 0→1
 * transition, and both consequences are deliberate. A child boundary swapping
 * beneath a still-mounted parent does NOT re-announce (the user is inside one
 * continuous wait the parent already announced); an interrupted navigation —
 * tapping a second link while the first skeleton is up — does pass through 0 and
 * announces again (that genuinely is a second wait).
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
    if (depth !== 0) return;

    // Nothing waiting to be named: clear the region NOW, exactly as before this
    // unit existed. A clear cannot be invalidated by what happens next — if a
    // boundary is taking over it republishes the loading message in the same
    // commit anyway — so this half stays synchronous and #983's contract is
    // untouched.
    if (pendingArrival === "") {
      seq += 1;
      publish({ message: "", seq });
      return;
    }

    // A destination IS waiting, and that is a one-shot announcement worth
    // protecting, so the decision waits for the commit to settle.
    scheduleArrivalFlush();
  };
}

let flushScheduled = false;

/**
 * Publish a deferred destination once the current commit has SETTLED.
 *
 * A boundary HANDOFF — one skeleton releasing as the next opens, which React
 * does inside a single commit — passes through depth 0 without the wait being
 * over. Publishing there CONSUMED the pending arrival while the incoming
 * boundary immediately overwrote it with the loading message, so the
 * destination was thrown away and the eventual release said nothing at all.
 * Measured in real Chrome on a project-detail navigation: `กำลังโหลด…` for 9 s,
 * then SILENCE — the announcement the whole unit exists for, gone.
 *
 * A microtask runs after the commit, so `depth` is truthful by then: still 0
 * means the wait genuinely ended; back above 0 means a handoff, and the pending
 * destination is simply left for the real release to speak. It survives either
 * way — if the user really did go elsewhere, the new title overwrites it.
 */
function scheduleArrivalFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    if (depth !== 0) return;

    // The wait is over. The title has been correct for most of a second, but the
    // page has only just appeared — THIS is the honest moment to name it.
    const arrived = pendingArrival;
    pendingArrival = "";
    seq += 1;
    publish({ message: arrived, seq });
  });
}

/**
 * Announce that the user has ARRIVED at `pageName` (already stripped — see
 * `pageNameFromTitle`).
 *
 * Deferred while a loading boundary is open: measured, the title is correct
 * 640–930ms BEFORE the content renders, so announcing on the title alone tells
 * the user they have landed on a page that is still a skeleton.
 *
 * Unlike the loading message this is left standing rather than cleared — there
 * is nothing to "finish", and a reader that queries the region later still gets
 * a truthful answer to "where am I".
 *
 * `""` is a NON-announcement and is ignored outright — you cannot announce
 * nothing. It reaches here from the ~3–170ms window where Next has removed the
 * title node, and from a page that set no title of its own; in both cases the
 * region must keep whatever it last truthfully said rather than blanking. (To
 * clear the region, open and close a loading boundary — that is the only thing
 * that legitimately empties it.)
 */
export function announceArrival(pageName: string): void {
  if (pageName === "") return;

  if (depth > 0) {
    pendingArrival = pageName;
    return;
  }

  // A fresh seq even when the words repeat: navigating back and forth lands on
  // the same name, and the region only speaks on a DOM mutation.
  seq += 1;
  publish({ message: pageName, seq });
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
