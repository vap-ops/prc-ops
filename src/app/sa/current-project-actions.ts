"use server";

// Spec 292 U4 — the SA current-project server actions: set/clear the transient
// view-override (the sa_active_project cookie) + pin the persisted primary site.
// Mirrors src/app/sa/plan/actions.ts: getActionUser gate, UUID validate, thin
// relay, Thai error map, revalidate. Lives under src/app/sa/** (NOT src/lib/auth/**)
// so it is code-only, not a danger-path file (spec 292 §Switcher UX). Cookie writes
// happen HERE — a Server Action — never in a GET render (Next.js cookie rule).

import "server-only";

import { revalidatePath } from "next/cache";
import { getActionUser, NOT_SIGNED_IN } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import {
  getSaVisibleProjects,
  setSaActiveProjectCookie,
  clearSaActiveProjectCookie,
} from "@/lib/sa/current-project.server";

const SA_HOME = "/sa";
const PLAN_PATH = "/sa/plan";
const GENERIC_ERROR = "เปลี่ยนไซต์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
const NOT_VISIBLE_ERROR = "ไม่พบโครงการนี้ในสิทธิ์ของคุณ";
const PIN_REJECT_ERROR = "ตั้งไซต์หลักไม่สำเร็จ — คุณไม่ได้เป็นสมาชิกของโครงการนี้";

export type CurrentProjectActionResult = { ok: true } | { ok: false; error: string };

// The chip lives on /sa; the plan picker on /sa/plan. Both read the resolved
// current project, so both revalidate on any override/pin change.
function revalidateScoped(): void {
  revalidatePath(SA_HOME);
  revalidatePath(PLAN_PATH);
}

/**
 * Set the session view-override to a project the caller can CURRENTLY see. The id
 * is re-validated against the caller's self-filtered visible list (forge guard) —
 * the cookie only ever names a visible project; the resolver validates again on
 * read (defence in depth). The cookie grants no privilege: RLS still gates every
 * read on auth.uid(), exactly like assumed_role.
 */
export async function setActiveProjectOverride(
  projectId: string,
): Promise<CurrentProjectActionResult> {
  if (!UUID_REGEX.test(projectId)) return { ok: false, error: GENERIC_ERROR };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const visible = await getSaVisibleProjects(auth.supabase, auth.user.id);
  if (!visible.some((p) => p.id === projectId)) {
    return { ok: false, error: NOT_VISIBLE_ERROR };
  }

  await setSaActiveProjectCookie(projectId);
  revalidateScoped();
  return { ok: true };
}

/** Clear the view-override → the scoped surfaces revert to the primary/derived. */
export async function clearActiveProjectOverride(): Promise<CurrentProjectActionResult> {
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  await clearSaActiveProjectCookie();
  revalidateScoped();
  return { ok: true };
}

/**
 * Pin the caller's primary site via the U1 DEFINER RPC set_primary_project (its
 * self-membership gate is load-bearing), then CLEAR the override cookie. Precedence
 * puts override above primary, so pinning A while a view still points at B would
 * visibly change nothing; pin means "make this my site now and henceforth", so it
 * drops the transient view in the same action (spec 292 §The setter).
 */
export async function pinPrimaryProject(projectId: string): Promise<CurrentProjectActionResult> {
  if (!UUID_REGEX.test(projectId)) return { ok: false, error: GENERIC_ERROR };
  const auth = await getActionUser();
  if (!auth) return { ok: false, error: NOT_SIGNED_IN };

  const { error } = await auth.supabase.rpc("set_primary_project", { p_project: projectId });
  if (error) {
    // 42501 = the self-membership gate rejected; 23505 = two set calls raced the
    // partial-unique index (a double-tap). Both → one friendly Thai line.
    return { ok: false, error: PIN_REJECT_ERROR };
  }

  await clearSaActiveProjectCookie();
  revalidateScoped();
  return { ok: true };
}
