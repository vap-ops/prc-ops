// Spec 371 U2 — the review-queue zone vocabulary, in a CLIENT-SAFE module.
//
// This lives apart from pending-summary.ts on purpose: that module starts with
// `import "server-only"`, and the nav badge is a Client Component. Importing the
// zone constant from there poisoned the client bundle and 500'd the whole
// dashboard ("You're importing a module that depends on server-only") — caught
// by the browser gate, invisible to vitest, which does not enforce the boundary.
// Keep this file free of server-only imports.

/** The zones of `public.work_package_review_queue` (spec 371 U2). */
export type ReviewZone = "first_review" | "ready_again" | "awaiting_site";

/**
 * The one zone that is NOT the PM's move.
 *
 * Exported because this literal crosses the SQL/TS boundary: the view generates
 * `zone` as plain `string`, so nothing type-checks a mismatch, and both the
 * badge's `.neq()` filter and `isActionableZone` below would silently start
 * counting everything if the SQL name ever changed. One home, so a rename breaks
 * in exactly one place.
 */
export const AWAITING_SITE_ZONE = "awaiting_site" satisfies ReviewZone;

/** Zones the PM can act on right now — everything except awaiting_site. */
export function isActionableZone(zone: ReviewZone): boolean {
  return zone !== AWAITING_SITE_ZONE;
}
