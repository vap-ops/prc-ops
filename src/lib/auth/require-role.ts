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

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/db/server";
import { roleHome, type UserRole } from "./role-home";
import { resolveEffectiveRole } from "./effective-role";
import { readAssumedRoleCookie } from "./assumed-role.server";

export type { UserRole } from "./role-home";

export interface UserContext {
  id: string;
  role: UserRole;
  fullName: string | null;
}

// Per-request memo of the caller's identity. A protected page and the server
// components it renders (labor cost views, contact blocks, the upload-queue
// runner, …) each call requireRole independently — without this, every one of
// them fires its own getClaims + users-row SELECT on the same render. React's
// cache() dedups them to a single load per request: the cache is request-scoped
// (it never crosses requests, so it can never return one user's row to another)
// and within a request the caller is always the same user. Returns null for the
// no-session / verify-failure / missing-row cases; requireRole maps null to the
// appropriate redirect so the gate's observable behaviour is unchanged.
const loadUserContext = cache(async (): Promise<UserContext | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) {
    return null;
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
    return null;
  }

  // Spec 274 — super_admin "View as role". The effective role is the assumed
  // role IFF the REAL role (row.role) is super_admin and the cookie is a valid
  // assumable role; otherwise the real role unchanged. resolveEffectiveRole
  // holds the forge-guard, so this is safe for every caller — a non-super with a
  // forged cookie resolves back to their own role. ctx.role downstream (the
  // allowlist check, roleHome, and every nav builder) follows automatically.
  const assumedRaw = await readAssumedRoleCookie();
  return {
    id: userId,
    role: resolveEffectiveRole(row.role, assumedRaw),
    fullName: row.full_name,
  };
});

export async function requireRole(allowedRoles: ReadonlyArray<UserRole>): Promise<UserContext> {
  const ctx = await loadUserContext();
  if (!ctx) {
    redirect("/login");
  }
  if (!allowedRoles.includes(ctx.role)) {
    redirect(roleHome(ctx.role));
  }
  return ctx;
}
