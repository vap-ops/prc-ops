// spec 263 follow-up — where an ALREADY-signed-in visitor to /login goes.
//
// Default (no/invalid next): roleHome(role) — byte-identical to today. When a
// valid same-origin `next` is present, honor it instead so the return-path
// round-trip completes for a user who was already logged in when they hit a
// bounce. Pure decision, extracted from the page so it is unit-testable
// without mocking Supabase auth. `next` is re-validated here (defense in
// depth) — never trusted from the caller.

import { roleHome, type UserRole } from "@/lib/auth/role-home";
import { safeNextPath } from "@/lib/auth/next-path";

export function loginRedirectTarget(next: string | null | undefined, role: UserRole): string {
  return safeNextPath(next) ?? roleHome(role);
}
