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
 * `title-node-removed` then `title-node-added` ~3–170ms later, with
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
  // What the user is currently on. The page loaded directly is the BASELINE to
  // compare against, never something to speak — screen readers announce a full
  // page load themselves.
  //
  // Keyed on the PATHNAME as well as the name, because the name alone is not a
  // navigation: 39 dynamic-segment pages carry ONE static title for every
  // record (`work-packages/[workPackageId]` is "รูปถ่ายงาน" for all of them), so
  // a name-only key treats every WP→WP move — the site admin's commonest
  // navigation — as a repeat and says nothing at all. The pathname is already
  // updated by the time the new title lands (measured: pathname +1074ms, title
  // node re-added +1100ms). Comparing both is also what the same-page case
  // needs: a router.refresh() keeps the pathname, so it still stays silent.
  const lastPath = useRef<string | null>(null);
  const lastName = useRef<string | null>(null);

  useEffect(() => {
    lastPath.current = window.location.pathname;
    lastName.current = pageNameFromTitle(document.title);

    const report = () => {
      const name = pageNameFromTitle(document.title);
      // "" is the node-swap gap, or a page that set no title. Say nothing — and
      // crucially do not let it BECOME the baseline. Every navigation passes
      // through that gap, so a poisoned baseline makes the next title look like
      // a change even when it is the same page: a same-title node replacement
      // would announce an arrival the user never made. (Dropping this test
      // leaves the announce path correct — announceArrival("") is itself a
      // no-op — which is exactly why the baseline is the half that matters.)
      if (name === "") return;

      const path = window.location.pathname;
      if (path === lastPath.current && name === lastName.current) return;
      lastPath.current = path;
      lastName.current = name;
      announceArrival(name);
    };

    // childList + subtree is the whole mechanism: Next replaces the <title>
    // NODE. `characterData` was here too and nothing could distinguish its
    // presence from its absence, so it is not carried on faith.
    const observer = new MutationObserver(report);
    observer.observe(document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

/**
 * Silence Next's own route announcer, which in this app is wrong when it speaks
 * at all.
 *
 * It is a `<next-route-announcer>` custom element whose shadow root holds a
 * `role="alert" aria-live="assertive"` div, and it reports `document.title` on
 * every router-tree change. Measured across 7 real navigations it was correct
 * ZERO times: usually it mutates to "" (harmless), and once it announced
 * "สวัสดี คุณ<ชื่อ>" — the SA home's `<h1>` greeting, i.e. the user's own name,
 * ASSERTIVELY, for a page they were not on. Root cause (measured): Next REPLACES
 * the `<title>` node rather than editing it, so `document.title` is empty for
 * ~3–170ms per navigation and its effect samples inside that window, falling
 * through to `querySelector("h1")`. Our polite region announces the destination
 * correctly on every one of those navigations, so this removes nothing that
 * works and removes a real, intermittent lie.
 *
 * The narrowest possible intervention: two ARIA attributes on one node. No
 * patched framework file, no removed DOM. Safe because React portals the
 * announcement TEXT into that div but does not own the element — proven in real
 * Chrome, where the change stuck across three navigations and a probe tag on the
 * node survived throughout.
 *
 * @returns whether the node was found (and therefore silenced).
 */
function silenceFrameworkAnnouncer(): boolean {
  const host = document.getElementsByTagName("next-route-announcer")[0];
  const region = host?.shadowRoot?.firstElementChild;
  if (!region) return false;

  region.setAttribute("aria-live", "off");
  // `role="alert"` is an assertive live region in its own right, so aria-live
  // alone would not be enough.
  region.removeAttribute("role");
  return true;
}

/**
 * Silences the framework announcer as soon as it exists.
 *
 * Next creates that node inside its OWN effect, and effect order between two
 * components is not something we control — so "not there when we looked" cannot
 * mean "give up". If it is missing we watch `document.body` (where Next appends
 * it) until it appears, then stop watching.
 */
function useSilencedFrameworkAnnouncer(): void {
  useEffect(() => {
    if (silenceFrameworkAnnouncer()) return;

    const observer = new MutationObserver(() => {
      if (silenceFrameworkAnnouncer()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
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
  useSilencedFrameworkAnnouncer();

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {/* Keyed on seq: every boundary says the same words, so without a fresh
          node identity the second navigation would render byte-identical output,
          the region would not mutate, and the reader would stay silent. */}
      {message ? <span key={seq}>{message}</span> : null}
    </div>
  );
}
