import "server-only";

// Spec 376 U4 (§3.3, D5) — "is this register door being opened inside SOMEONE
// ELSE's session?", answered once for both doors (/register/technician and
// /register/office render the same interstitial).
//
// The read mirrors StaffRegisterWorkspace's own auth read exactly — getClaims()
// (local JWT verify against the cached JWKS, ADR 0021: no Auth round-trip on the
// render path) then the caller's own `users` row on the RLS session. It runs
// BEFORE the workspace so it precedes the workspace's silent redirects, which are
// half of the reported symptom: a borrowed `technician` session was bounced into
// that person's home with no explanation at all.

import { createClient } from "@/lib/db/server";
import { getOwnTechnicianRegistration } from "@/lib/register/own-registration";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";
import type { Database } from "@/lib/db/database.types";

// Local alias, as in docs-owed.ts / card-view.ts (the register lib's convention).
type RegistrationStatus = Database["public"]["Enums"]["registration_status"];

export interface OwnRegistrationState {
  status: RegistrationStatus;
  /** `staff_registrations.documents_deferred_at` (spec 333 U2). */
  documentsDeferredAt: string | null;
}

/** Does this door still RENDER the caller's own registration row? That — not the
 * role — is what makes the session belong to the person standing there.
 *
 * Mirrors StaffRegisterWorkspace's own branching: a `pending` row gets the status
 * view + edit form, a `rejected` row gets the reason + form, and an `approved`
 * row is redirected home EXCEPT while `documents_deferred_at` is set, which is
 * the spec-333 U2 docs-owed view. Keep this in step with the workspace: a row the
 * workspace serves but this helper calls unserved is a person locked out of their
 * own flow — the 2026-07-30 `legal` incident. */
export function servesOwnRegistration(registration: OwnRegistrationState | null): boolean {
  if (!registration) return false;
  if (registration.status !== "approved") return true;
  return registration.documentsDeferredAt !== null;
}

export interface RegisterSessionIdentity {
  /** The signed-in user's role (`public.users.role`). */
  role: UserRole;
  /** Whether the caller holds an own registration THIS DOOR STILL SERVES
   * (servesOwnRegistration). A role-only rule was refuted by live data: two
   * `legal` users' one remaining step is on this page, and the deferred-docs view
   * is served to approved office roles — both would have been locked out. */
  hasOwnRegistration: boolean;
}

/** Foreign ⇔ a session exists AND its owner is not the person this door serves.
 *
 * Exhaustive over the live `user_role` domain in BOTH registration directions: a
 * served registration clears every role, and without one every role except
 * `visitor` (who is always a would-be registrant, registration or not) is
 * borrowed. A new enum value therefore classifies as foreign-when-unregistered —
 * and reds the domain pin, which is where that call gets made. */
export function isForeignSession({ role, hasOwnRegistration }: RegisterSessionIdentity): boolean {
  if (hasOwnRegistration) return false;
  return role !== "visitor";
}

export interface BorrowedRegisterSession {
  /** Whose session this is. Never blank: the app name, else the LINE-owned name,
   * else the role label — a screen that asks "is this you?" must name something. */
  displayName: string;
}

/** The signed-in identity when a register door is being opened inside someone
 * else's session; `null` when the door belongs to whoever is holding the phone
 * (no session at all — the workspace owns that login redirect — or a visitor). */
export async function borrowedRegisterSession(): Promise<BorrowedRegisterSession | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;

  const uid = data.claims.sub;
  const { data: row } = await supabase
    .from("users")
    .select("role, full_name, line_display_name")
    .eq("id", uid)
    .maybeSingle();
  if (!row) return null;

  // The own-row read the workspace also makes (RLS own-row policy, spec 263 G1).
  // Deliberately unconditional: deriving hasOwnRegistration only for some roles
  // would put a second copy of the rule in the caller.
  const registration = await getOwnTechnicianRegistration(supabase, uid);
  const hasOwnRegistration = servesOwnRegistration(
    registration
      ? { status: registration.status, documentsDeferredAt: registration.documents_deferred_at }
      : null,
  );
  if (!isForeignSession({ role: row.role, hasOwnRegistration })) return null;

  return { displayName: row.full_name ?? row.line_display_name ?? USER_ROLE_LABEL[row.role] };
}
