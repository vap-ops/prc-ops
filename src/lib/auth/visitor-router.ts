// Spec 264 G3 / ADR 0072 §8 — the /coming-soon page becomes role-aware. For a
// `visitor` it is a context-aware landing hub; for every OTHER still-unbuilt role
// it stays the static "tools not ready" page. This module is the PURE routing
// decision (no Supabase, no server-only) so the page shell renders/redirects off
// a single tested function — and the redirect-loop invariant is checkable in
// isolation.
//
// FEASIBILITY (spec doc §"Homes / routing"): a visitor's pending STAFF
// registration IS detectable — staff_registrations.user_id = the visitor's uid,
// readable via the G1 own-row RLS policy. A pending contractor/client INVITE is
// NOT — invites are token-held, unbound to the visitor's user_id until claimed.
// So the router never attempts to detect an invite (the invited person already
// holds their claim link). Two real arms + a default:
//   1. visitor WITH a staff_registration (any status)  → redirect to their
//      /register/technician workspace (which itself renders pending/rejected and
//      does its own approved→home redirect).
//   2. organic visitor (no registration)               → render the CTA landing
//      (a "สมัครเป็นช่าง" primary CTA + an "open your invite link" note). It
//      RENDERS, never redirects — /coming-soon is the visitor destination of
//      roleHome, so redirecting a bare visitor anywhere in the login/home cycle
//      would loop.
//   3. any other (still-unbuilt) role                  → the static page.

import type { UserRole } from "@/lib/db/enums";

/**
 * The register workspace the visitor router redirects a registered visitor to.
 * The open self-serve technician link is KEPT (spec 264 G1 decision) — it is the
 * technician *instance* of the role-neutral staff flow.
 */
export const REGISTER_WORKSPACE_PATH = "/register/technician";

/**
 * The outcome the /coming-soon page acts on. A discriminated union so the page
 * either `redirect()`s (one case only) or renders one of two shells — never both,
 * never a fallthrough.
 */
export type ComingSoonDecision =
  | { kind: "redirect"; to: typeof REGISTER_WORKSPACE_PATH }
  | { kind: "visitor-landing" }
  | { kind: "static" };

/**
 * Pure: given the caller's role and whether they hold a staff_registration row
 * (any status), decide what /coming-soon does.
 *
 * Only a `visitor` is ever router-eligible — a non-visitor unbuilt role has a real
 * role already and MUST stay on the static page, even if the flag were somehow
 * set (the flag can never redirect another role into the register flow). The lone
 * redirect is a registered visitor → the register workspace; a bare visitor
 * renders the CTA landing (loop-safe).
 */
export function comingSoonDecision(
  role: UserRole,
  hasStaffRegistration: boolean,
): ComingSoonDecision {
  if (role !== "visitor") return { kind: "static" };
  if (hasStaffRegistration) return { kind: "redirect", to: REGISTER_WORKSPACE_PATH };
  return { kind: "visitor-landing" };
}
