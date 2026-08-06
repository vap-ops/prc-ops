// Spec 397 U3 — where the reopen form returns to, and what it says when it lands.
//
// Pure, and in its own leaf module for two reasons: a `"use server"` file may only
// export async functions (so this could not live beside the action), and the
// redirect target is the part that shipped WRONG in review — the outcome was
// appended after the `#w-<workerId>` fragment the drill link carries, so
// `?reopened=1` was swallowed by the hash and BOTH outcome banners were dead code.
// A silent failure on a refusal path is the exact class this repo ratchets against,
// so the builder is now a function with its own tests.

import { safeBackHref } from "@/lib/nav/back-href";

/**
 * Outcome CODES, never the sentence. A Thai message in a URL survives in history
 * and screenshots, is unbounded, and would let any crafted link render
 * attacker-chosen text inside the app's own error notice. The page owns the copy.
 */
export type ReopenOutcome =
  | "ok"
  /** The caller's role may not reopen (a permanent 42501). */
  | "denied"
  /** Wages are already booked for that day — retract them first. */
  | "wages"
  /** The day was not closed (someone else reopened it, or a stale form). */
  | "notclosed"
  /** A malformed project id or date — never retryable. */
  | "shape"
  /** Anything else the database refused. */
  | "failed";

/**
 * Spec 400 U3b — the outcomes of `close_muster_day`. Fewer arms than reopen
 * because the RPC is idempotent: it upserts the closure and re-derives, so
 * closing an already-closed day is a no-op rather than a refusal.
 */
export type CloseOutcome =
  | "ok"
  /** The caller's role, or its project scope, was refused (42501). */
  | "denied"
  /** A malformed project id or date — never retryable. */
  | "shape"
  /** Today or later: the surface withholds the control, the action re-checks it. */
  | "notover"
  /** Anything else the database refused. */
  | "failed";

/**
 * Build the redirect target: the caller's own URL, validated the same way every
 * other back-link in the app is, with the outcome added BEFORE any fragment so
 * the page can actually read it.
 */
function returnWith(rawBack: string | undefined, param: string): string {
  // safeBackHref, not a hand-rolled startsWith: this value comes from a form
  // field, and the hand-rolled check accepted `/\evil.com`, which browsers
  // normalise to a protocol-relative URL — an off-app redirect out of a Server
  // Action. safeBackHref rejects `//`, `\`, `://` and control characters.
  const back = safeBackHref(rawBack, "/team/attendance");
  const hashAt = back.indexOf("#");
  const base = hashAt === -1 ? back : back.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : back.slice(hashAt);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${param}${hash}`;
}

export function reopenReturnTo(rawBack: string | undefined, outcome: ReopenOutcome): string {
  return returnWith(rawBack, outcome === "ok" ? "reopened=1" : `reopenError=${outcome}`);
}

/**
 * The close form's twin. Shares `returnWith` rather than repeating it: the
 * fragment bug this module exists for (the outcome appended AFTER `#w-<id>`, so
 * both banners were dead code) is a property of the URL shape, not of one form —
 * and the panel's own href ends `#d-<date>`, so a second hand-rolled builder
 * would reproduce it exactly.
 */
export function closeReturnTo(rawBack: string | undefined, outcome: CloseOutcome): string {
  return returnWith(rawBack, outcome === "ok" ? "closed=1" : `closeError=${outcome}`);
}
