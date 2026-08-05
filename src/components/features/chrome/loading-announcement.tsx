"use client";

// The shared announcement leaf every route-loading boundary renders (#980
// follow-up). One component so the 38 boundaries that delegate to PageSkeleton
// and the one bespoke skeleton (src/app/portal/loading.tsx) cannot drift apart.
//
// Two channels, one string, because the two navigation paths differ:
//   • full page load  — the reader walks the document top-down and reads the
//     static sr-only line below before the fallback is replaced;
//   • client-side nav — the fallback is a DOM swap, which readers announce only
//     inside a live region, so the effect writes to the persistent region in the
//     root layout (<RouteAnnouncer />) instead.
//
// 'use client' justification (ui-conventions §9 keeps skeletons as Server
// Components): this leaf earns it on lifecycle alone — mount/unmount is the
// signal. Keeping it a separate leaf is what lets PageSkeleton and the portal
// skeleton stay server components.

import { useEffect } from "react";

import { ROUTE_LOADING_MESSAGE, beginRouteLoading } from "@/lib/ui/route-announcement";

export function LoadingAnnouncement() {
  // beginRouteLoading returns its own release, so the boundary announces for
  // exactly as long as it is on screen.
  useEffect(() => beginRouteLoading(), []);

  return <p className="sr-only">{ROUTE_LOADING_MESSAGE}</p>;
}
