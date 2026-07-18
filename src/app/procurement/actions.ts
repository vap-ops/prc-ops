"use server";

// Spec 327 U1 — the procurement selection Server Actions: set/clear the
// procurement_project cookie. Mirrors src/app/sa/current-project-actions.ts
// (spec 292): getActionUser gate, UUID validate, visibility re-check against
// the caller's RLS projects read (forge guard — the cookie only ever names a
// visible project; resolveSelectedProject validates again on read, defence in
// depth). Lives under src/app/procurement/** so it is code-only, not a
// danger-path file. Cookie writes happen HERE — a Server Action — never in a
// GET render (Next.js cookie rule); the dashboard's project cards are <form>
// submits bound to setProcurementProject.

import "server-only";

import { redirect } from "next/navigation";
import { getActionUser } from "@/lib/auth/action-gate";
import { UUID_REGEX } from "@/lib/validate/uuid";
import {
  setProcurementProjectCookie,
  clearProcurementProjectCookie,
} from "@/lib/purchasing/procurement-project.server";

/**
 * Select a project → land on its ขอบเขต view (the first S/T/R question). An
 * invalid/forged/invisible id sets nothing and returns to the dashboard — the
 * card list comes from the same RLS read, so this only fires on a stale form
 * or a forged POST (§0.4: never strand on a bad selection).
 */
export async function setProcurementProject(projectId: string): Promise<void> {
  if (UUID_REGEX.test(projectId)) {
    const auth = await getActionUser();
    if (!auth) redirect("/procurement");
    const { data } = await auth.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (data) {
      await setProcurementProjectCookie(projectId);
      redirect("/procurement/scope");
    }
  }
  redirect("/procurement");
}

/** Back to ทุกโครงการ — clears the selection, lands on the dashboard. */
export async function clearProcurementProject(): Promise<void> {
  await clearProcurementProjectCookie();
  redirect("/procurement");
}
