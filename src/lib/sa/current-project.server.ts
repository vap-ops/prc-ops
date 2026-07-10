// Spec 292 U2 — server half of the SA current-project resolver: cookie I/O +
// the self-filtered membership read. Split from the pure ./current-project so
// next/headers never reaches a client bundle (mirrors assumed-role.server.ts,
// spec 274). Cookie posture matches assumed_role: httpOnly + secure + lax +
// path=/ and SESSION-scoped (no maxAge — a transient view must not outlive the
// browser session and shadow the primary). U2 ships the reader only; the
// set/clear server actions are U4.
//
// The membership read MUST self-filter: the project_members SELECT policy is
// role-gated ("readable by staff"), NOT own-row — a site_admin reads ALL
// members of visible projects, so the embed filters user_id = the caller
// explicitly or the annotation picks up other users' rows.

import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import {
  resolveSaCurrentProject,
  type SaCurrentProject,
  type SaVisibleProject,
} from "./current-project";

/** The session cookie carrying the transient view-override. Server-set (U4). */
export const SA_ACTIVE_PROJECT_COOKIE = "sa_active_project";

/** A visible project annotated for the resolver, plus name so consumers that
 * already list projects (the plan picker) can reuse this one read. */
export type SaVisibleProjectRow = SaVisibleProject & { name: string };

/** Raw sa_active_project cookie value for this request, or null. Fails safe:
 * no request store (tests, non-request callers) → null → the resolver falls
 * through to primary/derived — never a spurious override. */
export async function readSaActiveProjectCookie(): Promise<string | null> {
  try {
    const jar = await cookies();
    return jar.get(SA_ACTIVE_PROJECT_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

/** Persist the transient view-override (spec 292 U4). SESSION cookie — no maxAge,
 * so a transient view never outlives the browser session and shadows the primary —
 * httpOnly + secure + lax + path=/, mirroring assumed_role (spec 274). Called ONLY
 * from a Server Action: a Server Component render cannot set cookies (Next.js). The
 * caller (setActiveProjectOverride) validates projectId against the visible list
 * first, and the resolver re-validates on read, so a stale cookie is inert. */
export async function setSaActiveProjectCookie(projectId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SA_ACTIVE_PROJECT_COOKIE, projectId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}

/** Clear the view-override → scoped surfaces revert to primary/derived. Idempotent. */
export async function clearSaActiveProjectCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SA_ACTIVE_PROJECT_COOKIE);
}

/** The caller's RLS-visible projects (member OR led), each annotated with the
 * caller's OWN membership row (self-filtered embed — see module note). A
 * lead-only project comes back with an empty embed → hasMembership false. */
export async function getSaVisibleProjects(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<SaVisibleProjectRow[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, code, name, project_members(is_primary, added_at)")
    .eq("project_members.user_id", userId)
    .order("code");
  return (data ?? []).map((p) => {
    const membership = p.project_members[0] ?? null;
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      isPrimary: membership?.is_primary ?? false,
      addedAt: membership?.added_at ?? null,
      hasMembership: membership !== null,
    };
  });
}

/** One-call resolution for server components: membership read + override
 * cookie → the pure resolver. Returns the visible list too so consumers
 * (the plan picker) don't re-read it. queryProjectId is the plan page's
 * ?project= deep-link — validated against the visible list inside the pure
 * resolver, view-only for that render. */
export async function getSaCurrentProject(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts?: { queryProjectId?: string | null },
): Promise<{ current: SaCurrentProject; visibleProjects: SaVisibleProjectRow[] }> {
  const [visibleProjects, overrideProjectId] = await Promise.all([
    getSaVisibleProjects(supabase, userId),
    readSaActiveProjectCookie(),
  ]);
  const current = resolveSaCurrentProject({
    visibleProjects,
    overrideProjectId,
    queryProjectId: opts?.queryProjectId ?? null,
  });
  return { current, visibleProjects };
}
