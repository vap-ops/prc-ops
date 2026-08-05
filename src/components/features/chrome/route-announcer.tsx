"use client";

// The ONE route-loading live region (#980 follow-up). Mounted once in the root
// layout, OUTSIDE {children}, so it is already in the document before any
// navigation starts and never unmounts.
//
// That placement is the whole design. A `role="status"` added inside a
// loading.tsx would enter the DOM already containing its text, and screen
// readers announce MUTATIONS of a region that was already there — not the
// arrival of a pre-filled one. #980 shipped the sr-only line on every boundary
// and said so honestly in its own review: parity, not audibility. This closes it.
//
// Polite, not assertive, on purpose, and the house rule is the primary reason:
// waiting is not an emergency and must not interrupt a reader mid-sentence —
// role="alert" is reserved for real events (same call as the update chip).
// Secondary: Next.js' own announcer is assertive, so if it ever fires its
// message outranks this one, which is the right priority. Do not read that as
// "arrival is covered" — measured live, it is not; see route-announcement.ts.

import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  announceArrival,
  getRouteAnnouncement,
  getServerRouteAnnouncement,
  pageNameFromTitle,
  subscribeRouteAnnouncement,
} from "@/lib/ui/route-announcement";

/**
 * Watches the document title and reports each new destination.
 *
 * It observes `document.head` rather than the `<title>` node, because Next
 * REPLACES that node on every navigation instead of editing its text (measured:
 * `title-node-removed` then `title-node-added` ~1–6ms later, with
 * `document.title` empty in between). A watcher bound to the original node
 * would go deaf after the first navigation — and that empty gap is exactly what
 * the framework's own announcer samples, which is why it speaks the wrong
 * thing. `pageNameFromTitle` maps the gap to "" so it is never announced.
 *
 * Lives inside the region component on purpose: this is already the one thing
 * mounted once in the root layout, so folding it in adds no second mount point
 * to keep pinned and no second client component to the bundle.
 */
function useArrivalAnnouncements(): void {
  // The title present at mount is the page the user loaded directly. Screen
  // readers announce a full page load themselves, so it is the baseline to
  // compare against, never something to speak.
  const lastAnnounced = useRef<string | null>(null);

  useEffect(() => {
    lastAnnounced.current = pageNameFromTitle(document.title);

    const report = () => {
      const name = pageNameFromTitle(document.title);
      // "" is the node-swap gap, or a page that set no title. Say nothing — and
      // crucially do not let it BECOME the baseline. Every navigation passes
      // through that gap, so a poisoned baseline makes the very next title look
      // like a change even when it is the same page: a router.refresh(), which
      // replaces the node with identical text, would announce an arrival the
      // user never made. (Dropping this `name === ""` test leaves the announce
      // path correct — announceArrival("") is itself a no-op — which is exactly
      // why the baseline is the half that matters.)
      if (name === "" || name === lastAnnounced.current) return;
      lastAnnounced.current = name;
      announceArrival(name);
    };

    const observer = new MutationObserver(report);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
}

export function RouteAnnouncer() {
  const { message, seq } = useSyncExternalStore(
    subscribeRouteAnnouncement,
    getRouteAnnouncement,
    getServerRouteAnnouncement,
  );
  useArrivalAnnouncements();

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {/* Keyed on seq: every boundary says the same words, so without a fresh
          node identity the second navigation would render byte-identical output,
          the region would not mutate, and the reader would stay silent. */}
      {message ? <span key={seq}>{message}</span> : null}
    </div>
  );
}
