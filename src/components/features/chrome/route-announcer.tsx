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
