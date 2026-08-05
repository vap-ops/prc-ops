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
// Polite, not assertive, on purpose: Next.js' own announcer speaks the
// destination title assertively on arrival, and that message should be allowed
// to interrupt this one.

import { useSyncExternalStore } from "react";

import {
  getRouteAnnouncement,
  getServerRouteAnnouncement,
  subscribeRouteAnnouncement,
} from "@/lib/ui/route-announcement";

export function RouteAnnouncer() {
  const { message, seq } = useSyncExternalStore(
    subscribeRouteAnnouncement,
    getRouteAnnouncement,
    getServerRouteAnnouncement,
  );

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {/* Keyed on seq: every boundary says the same words, so without a fresh
          node identity the second navigation would render byte-identical output,
          the region would not mutate, and the reader would stay silent. */}
      {message ? <span key={seq}>{message}</span> : null}
    </div>
  );
}
