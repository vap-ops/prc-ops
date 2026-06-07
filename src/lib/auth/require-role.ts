// Server-Component gate. Verifies the session JWT locally (no Auth-server
// round-trip — see ADR 0021), looks up the caller's role, and returns a
// typed UserContext for the page to render. Routes the not-allowed branch
// through roleHome() — never blanket-redirect to /coming-soon, since a
// site_admin who lands on /pm should go to /sa, not the not-yet-served
// landing page.
//
// getClaims() returns one of three shapes:
//   { data: { claims, header, signature }, error: null }     success
//   { data: null,                          error: AuthError } verify failed
//   { data: null,                          error: null }      no session
// We collapse the two failure shapes by checking `!data` — both end at
// /login. The middleware (proxy.ts) still uses getUser() once per request
// to refresh the session and serve the authoritative GoTrue check; this
// gate is the read-render path that runs on every protected page render.

import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { roleHome, type UserRole } from "./role-home";

export type { UserRole } from "./role-home";

export interface UserContext {
  id: string;
  role: UserRole;
  fullName: string | null;
}

export async function requireRole(allowedRoles: ReadonlyArray<UserRole>): Promise<UserContext> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) {
    redirect("/login");
  }
  const userId = data.claims.sub;

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (!row) {
    // Defensive: post-login the row always exists (ADR 0007 trigger), but if
    // it's somehow missing the safest thing is to send the user back to /login
    // rather than guess a role.
    console.error("[requireRole] users row missing", { userId });
    redirect("/login");
  }

  const role = row.role as UserRole;
  if (!allowedRoles.includes(role)) {
    redirect(roleHome(role));
  }

  return {
    id: userId,
    role,
    fullName: row.full_name,
  };
}
