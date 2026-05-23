// Server-Component gate. Reads the session, looks up the caller's role, and
// returns a typed UserContext for the page to render. Routes the not-allowed
// branch through roleHome() — never blanket-redirect to /coming-soon, since
// a site_admin who lands on /pm should go to /sa, not the not-yet-served
// landing page.

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: row } = await supabase
    .from("users")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!row) {
    // Defensive: post-login the row always exists (ADR 0007 trigger), but if
    // it's somehow missing the safest thing is to send the user back to /login
    // rather than guess a role.
    console.error("[requireRole] users row missing", { userId: user.id });
    redirect("/login");
  }

  const role = row.role as UserRole;
  if (!allowedRoles.includes(role)) {
    redirect(roleHome(role));
  }

  return {
    id: user.id,
    role,
    fullName: row.full_name,
  };
}
