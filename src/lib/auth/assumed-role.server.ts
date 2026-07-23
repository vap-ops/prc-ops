// Spec 274 — server-side cookie I/O for the super_admin "View as role" override.
// Split from the pure ./effective-role (which the client picker also imports) so
// next/headers never reaches a client bundle. The cookie is httpOnly (only the
// server ever reads it) + secure + lax, mirroring the LINE state-cookie posture
// (src/app/auth/line/start/route.ts). Forgeability is a non-issue: the override
// only takes effect when the caller's REAL role may assume that specific value
// (canAssume — super_admin → any served role, procurement_manager → site_admin;
// see resolveEffectiveRole), so a forged cookie is inert — httpOnly is
// defence-in-depth, not the boundary.

import "server-only";

import { cookies } from "next/headers";
import type { UserRole } from "@/lib/db/enums";
import { ASSUMED_ROLE_COOKIE } from "./effective-role";

/** Raw `assumed_role` cookie value for this request, or null. Fails safe: any
 * context without a request store (no cookie to read) yields null, so the
 * effective-role resolver falls back to the REAL role — never a spurious
 * override. Production server actions/components always have a request scope;
 * the catch matters for non-request callers (and tests). */
export async function readAssumedRoleCookie(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(ASSUMED_ROLE_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** Enter "view as": persist the assumed role. Caller MUST have verified the real
 * role may assume this target first (canAssume, in the setAssumedRole action). */
export async function setAssumedRoleCookie(role: UserRole): Promise<void> {
  const jar = await cookies();
  jar.set(ASSUMED_ROLE_COOKIE, role, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

/** Exit "view as" (also called on logout). Idempotent. */
export async function clearAssumedRoleCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(ASSUMED_ROLE_COOKIE);
}
