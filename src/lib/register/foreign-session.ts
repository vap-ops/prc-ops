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
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

export interface RegisterSessionIdentity {
  /** The signed-in user's role (`public.users.role`). */
  role: UserRole;
  /** Whether that user holds their OWN `staff_registration`.
   *
   * Accepted and DELIBERATELY inert — it is the input a reader expects to matter,
   * and the answer is that it must not: a `visitor` mid-registration IS the
   * registrant (their pending/rejected workspace is the whole point of the door),
   * and no registration makes a non-visitor role the person standing there. Both
   * directions are pinned in foreign-session-notice.test.tsx; keeping the field
   * means the callers pay no `staff_registrations` read to answer this, and the
   * refutation is visible in the type rather than lost in a comment. */
  hasOwnRegistration?: boolean;
}

/** Exhaustive over the live `user_role` domain: every role EXCEPT `visitor` is a
 * borrowed session at a register door. A new enum value therefore classifies as
 * foreign — and reds the domain pin, which is where that call gets made. */
export function isForeignSession({ role }: RegisterSessionIdentity): boolean {
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

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name, line_display_name")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (!row) return null;
  if (!isForeignSession({ role: row.role })) return null;

  return { displayName: row.full_name ?? row.line_display_name ?? USER_ROLE_LABEL[row.role] };
}
